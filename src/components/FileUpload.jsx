/**
 * FileUpload.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Composant d'upload de pièces justificatives (factures, reçus, conventions, statuts).
 * Stockage ultra-fiable :
 * 1. Conversion DataURL Base64 directe dans Firestore pour consultation instantanée
 *    garantie sans dépendre obligatoirement d'un bucket Firebase Storage.
 * 2. Optimisation automatique des photos de reçus (redimensionnement intelligent).
 * 3. Envoi simultané vers Firebase Storage si disponible.
 */
import { useState, useCallback } from 'react';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { useDropzone } from 'react-dropzone';
import { storage, db } from '../firebase';
import { useAuth } from '../context/AuthContext';

const ACCEPTED = {
    'application/pdf': ['.pdf'],
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/png': ['.png'],
    'image/webp': ['.webp'],
    'image/heic': ['.heic'],
};

function formatSize(bytes) {
    if (!bytes || bytes <= 0) return '0 o';
    if (bytes < 1024) return `${bytes} o`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

async function optimizeImageIfNeeded(dataUrl, fileType) {
    if (!fileType || !fileType.startsWith('image')) return dataUrl;
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const maxDim = 1200;
            let { width, height } = img;
            if (width > maxDim || height > maxDim) {
                if (width > height) {
                    height = Math.round((height * maxDim) / width);
                    width = maxDim;
                } else {
                    width = Math.round((width * maxDim) / height);
                    height = maxDim;
                }
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
    });
}

/**
 * @param {Object} props
 * @param {string} [props.sourceType] - "facture" | "depense" | "cca_apport" | "cca_remboursement" | "capital"
 * @param {string} [props.sourceId]   - ID du document métier rattaché
 * @param {Function} [props.onUploaded] - callback({ documentId, downloadURL, nom, dataUrl })
 */
export function FileUpload({ sourceType = 'depense', sourceId = null, onUploaded }) {
    const { user } = useAuth();
    const [files, setFiles] = useState([]);
    const [errors, setErrors] = useState([]);

    const onDrop = useCallback(
        async (acceptedFiles, rejected) => {
            if (rejected && rejected.length > 0) {
                setErrors(rejected.map((r) => `${r.file?.name || 'Fichier'} : format non accepté`));
            } else {
                setErrors([]);
            }

            for (const file of acceptedFiles) {
                const fileEntry = {
                    name: file.name,
                    size: file.size,
                    type: file.type.startsWith('image') ? 'image' : 'pdf',
                    progress: 20,
                    url: null,
                    docId: null,
                    error: null,
                };
                setFiles((prev) => [...prev, fileEntry]);

                try {
                    // 1. Lire en DataURL pour stockage garanti et prévisualisation
                    const rawDataUrl = await readFileAsDataURL(file);
                    const processedDataUrl = await optimizeImageIfNeeded(rawDataUrl, file.type);

                    // 2. Tentative de stockage Firebase Storage en tâche de fond (optionnel)
                    let storageDownloadUrl = null;
                    let storagePath = null;
                    try {
                        const uid = user?.uid || 'user';
                        storagePath = `justificatifs/${uid}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
                        const storageRef = ref(storage, storagePath);
                        const uploadTask = uploadBytesResumable(storageRef, file);

                        await new Promise((resolve) => {
                            uploadTask.on(
                                'state_changed',
                                (snap) => {
                                    const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 70) + 20;
                                    setFiles((prev) =>
                                        prev.map((f) => (f.name === file.name ? { ...f, progress: pct } : f))
                                    );
                                },
                                (err) => {
                                    // Non bloquant : on continuera avec le DataURL direct dans Firestore
                                    console.warn('[FileUpload] Stockage Firebase Storage non disponible, enregistrement Firestore direct:', err.message);
                                    resolve(null);
                                },
                                async () => {
                                    try {
                                        storageDownloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
                                    } catch (e) {
                                        console.warn('[FileUpload] Récupération downloadURL échouée :', e.message);
                                    }
                                    resolve(storageDownloadUrl);
                                }
                            );
                        });
                    } catch (storageErr) {
                        console.warn('[FileUpload] Erreur initialisation storage :', storageErr);
                    }

                    // 3. Enregistrer dans la collection Firestore /documents
                    const docPayload = {
                        nom: file.name,
                        type: file.type.startsWith('image') ? 'image' : 'pdf',
                        mimeType: file.type || 'application/octet-stream',
                        taille: file.size,
                        // Stocke la DataURL Base64 directement pour affichage garanti sans dépendance externe
                        dataUrl: processedDataUrl,
                        // downloadURL pointe vers Storage si réussi, sinon vers dataUrl
                        downloadURL: storageDownloadUrl || processedDataUrl,
                        storageRef: storagePath || null,
                        sourceType: sourceType || 'general',
                        sourceId: sourceId || null,
                        uploadedBy: user?.uid || 'admin',
                        uploaderEmail: user?.email || null,
                        createdAt: serverTimestamp(),
                    };

                    const docRef = await addDoc(collection(db, 'documents'), docPayload);

                    setFiles((prev) =>
                        prev.map((f) =>
                            f.name === file.name
                                ? {
                                    ...f,
                                    progress: 100,
                                    url: storageDownloadUrl || processedDataUrl,
                                    docId: docRef.id,
                                }
                                : f
                        )
                    );

                    onUploaded?.({
                        documentId: docRef.id,
                        downloadURL: storageDownloadUrl || processedDataUrl,
                        dataUrl: processedDataUrl,
                        nom: file.name,
                        taille: file.size,
                        type: file.type.startsWith('image') ? 'image' : 'pdf',
                    });
                } catch (err) {
                    console.error('[FileUpload] Échec complet upload :', err);
                    setFiles((prev) =>
                        prev.map((f) =>
                            f.name === file.name ? { ...f, error: err.message, progress: 0 } : f
                        )
                    );
                    setErrors((e) => [...e, `Erreur enregistrement ${file.name} : ${err.message}`]);
                }
            }
        },
        [user, sourceType, sourceId, onUploaded]
    );

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: ACCEPTED,
        multiple: true,
    });

    return (
        <div>
            <div
                {...getRootProps()}
                className={`dropzone ${isDragActive ? 'dropzone--active' : ''}`}
                style={{
                    border: '2px dashed var(--border)',
                    borderRadius: 8,
                    padding: '20px 16px',
                    textAlign: 'center',
                    backgroundColor: isDragActive ? 'var(--bg3)' : 'var(--bg2)',
                    cursor: 'pointer',
                    transition: 'border-color 0.2s, background-color 0.2s',
                }}
            >
                <input {...getInputProps()} />
                <div style={{ fontSize: 24, marginBottom: 6 }}>📎</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                    {isDragActive
                        ? 'Déposez les pièces justificatives ici'
                        : 'Glissez-déposez vos justificatifs ici (PDF, JPG, PNG, WEBP), ou cliquez pour sélectionner'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    Factures d'achat, reçus de virement, attestations bancaires, conventions CCA...
                </div>
            </div>

            {errors.length > 0 && (
                <div className="notice notice--danger" style={{ marginTop: 10 }}>
                    {errors.map((e, i) => (
                        <div key={i}>{e}</div>
                    ))}
                </div>
            )}

            {files.length > 0 && (
                <div className="file-list" style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {files.map((f, i) => (
                        <div
                            key={i}
                            className="file-item"
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '8px 12px',
                                background: 'var(--bg)',
                                border: '1px solid var(--border)',
                                borderRadius: 6,
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                                <span style={{ fontSize: 18 }}>{f.type === 'pdf' ? '📄' : '🖼️'}</span>
                                <div style={{ minWidth: 0 }}>
                                    <div
                                        style={{
                                            fontSize: 13,
                                            fontWeight: 600,
                                            color: 'var(--text)',
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            maxWidth: 260,
                                        }}
                                    >
                                        {f.name}
                                    </div>
                                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                        {formatSize(f.size)}
                                    </div>
                                </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                {f.progress < 100 && !f.error ? (
                                    <span style={{ color: 'var(--accent)', fontSize: 12, fontWeight: 600 }}>
                                        Enregistrement... {f.progress}%
                                    </span>
                                ) : f.error ? (
                                    <span style={{ color: 'var(--danger)', fontSize: 12 }}>Échec</span>
                                ) : (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <span style={{ color: 'var(--success)', fontSize: 12, fontWeight: 600 }}>
                                            ✓ Enregistré
                                        </span>
                                        {f.url && (
                                            <a
                                                href={f.url}
                                                target="_blank"
                                                rel="noreferrer"
                                                download={f.name}
                                                className="btn btn--sm btn--ghost"
                                                style={{ fontSize: 11, padding: '2px 8px' }}
                                            >
                                                Ouvrir 👁️
                                            </a>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
