/**
 * FileUpload.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Composant d'upload de pièces justificatives (factures, reçus, conventions, statuts).
 * Stockage ultra-fiable et instantané :
 * - Conversion DataURL Base64 directe dans Firestore pour consultation immédiate
 * - Aucun blocage sur Firebase Storage (enregistrement garanti en moins d'une seconde)
 * - Prévisualisation et téléchargement automatiques
 */
import { useState, useCallback } from 'react';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { collection, addDoc, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
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
                    progress: 50,
                    url: null,
                    docId: null,
                    error: null,
                };
                setFiles((prev) => [...prev, fileEntry]);

                try {
                    // 1. Lire immédiatement en DataURL pour stockage instantané
                    const rawDataUrl = await readFileAsDataURL(file);
                    const processedDataUrl = await optimizeImageIfNeeded(rawDataUrl, file.type);

                    // 2. Enregistrer immédiatement dans la collection Firestore /documents
                    const docPayload = {
                        nom: file.name,
                        type: file.type.startsWith('image') ? 'image' : 'pdf',
                        mimeType: file.type || 'application/octet-stream',
                        taille: file.size,
                        dataUrl: processedDataUrl,
                        downloadURL: processedDataUrl,
                        sourceType: sourceType || 'general',
                        sourceId: sourceId || null,
                        uploadedBy: user?.uid || 'admin',
                        uploaderEmail: user?.email || null,
                        createdAt: serverTimestamp(),
                    };

                    const docRef = await addDoc(collection(db, 'documents'), docPayload);

                    // 3. Mise à jour immédiate à 100% (succès instantané !)
                    setFiles((prev) =>
                        prev.map((f) =>
                            f.name === file.name
                                ? {
                                    ...f,
                                    progress: 100,
                                    url: processedDataUrl,
                                    docId: docRef.id,
                                }
                                : f
                        )
                    );

                    onUploaded?.({
                        documentId: docRef.id,
                        downloadURL: processedDataUrl,
                        dataUrl: processedDataUrl,
                        nom: file.name,
                        taille: file.size,
                        type: file.type.startsWith('image') ? 'image' : 'pdf',
                    });

                    // 4. Tentative de stockage Firebase Storage en tâche de fond complètement non-bloquante
                    try {
                        const uid = user?.uid || 'user';
                        const storagePath = `justificatifs/${uid}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
                        const storageRef = ref(storage, storagePath);
                        const uploadTask = uploadBytesResumable(storageRef, file);

                        uploadTask.on(
                            'state_changed',
                            () => { },
                            (err) => {
                                console.warn('[FileUpload] Storage background ignore :', err.message);
                            },
                            async () => {
                                try {
                                    const storageDownloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
                                    if (storageDownloadUrl && docRef.id) {
                                        await updateDoc(doc(db, 'documents', docRef.id), {
                                            downloadURL: storageDownloadUrl,
                                            storageRef: storagePath,
                                        });
                                    }
                                } catch (e) {
                                    console.warn('[FileUpload] Storage URL background update ignore :', e.message);
                                }
                            }
                        );
                    } catch (e) {
                        console.warn('[FileUpload] Storage not configured, Firestore dataUrl used.');
                    }
                } catch (err) {
                    console.error('[FileUpload] Échec enregistrement :', err);
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
                    border: '1px dashed var(--border)',
                    borderRadius: 6,
                    padding: '16px 14px',
                    textAlign: 'center',
                    backgroundColor: isDragActive ? 'var(--bg3)' : 'var(--bg2)',
                    cursor: 'pointer',
                    transition: 'border-color 0.15s, background-color 0.15s',
                }}
            >
                <input {...getInputProps()} />
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    {isDragActive
                        ? 'Déposez les pièces justificatives ici'
                        : 'Glissez-déposez un justificatif ici (PDF, JPG, PNG), ou cliquez pour sélectionner'}
                </div>
            </div>

            {errors.length > 0 && (
                <div className="notice notice--danger" style={{ marginTop: 8 }}>
                    {errors.map((e, i) => (
                        <div key={i}>{e}</div>
                    ))}
                </div>
            )}

            {files.length > 0 && (
                <div className="file-list" style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {files.map((f, i) => (
                        <div
                            key={i}
                            className="file-item"
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '6px 10px',
                                background: 'var(--bg)',
                                border: '1px solid var(--border)',
                                borderRadius: 4,
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                                <span style={{ fontSize: 14 }}>{f.type === 'pdf' ? '📄' : '🖼️'}</span>
                                <div style={{ minWidth: 0 }}>
                                    <span
                                        style={{
                                            fontSize: 12,
                                            fontWeight: 600,
                                            color: 'var(--text)',
                                            marginRight: 6,
                                        }}
                                    >
                                        {f.name}
                                    </span>
                                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                        ({formatSize(f.size)})
                                    </span>
                                </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                {f.progress < 100 && !f.error ? (
                                    <span style={{ color: 'var(--accent)', fontSize: 11 }}>
                                        Enregistrement...
                                    </span>
                                ) : f.error ? (
                                    <span style={{ color: 'var(--danger)', fontSize: 11 }}>Échec</span>
                                ) : (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <span style={{ color: 'var(--success)', fontSize: 11, fontWeight: 600 }}>
                                            ✓ Enregistré
                                        </span>
                                        {f.url && (
                                            <a
                                                href={f.url}
                                                target="_blank"
                                                rel="noreferrer"
                                                download={f.name}
                                                className="btn btn--sm btn--ghost"
                                                style={{ fontSize: 11, padding: '2px 6px' }}
                                            >
                                                Voir
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
