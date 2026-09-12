/**
 * Composant upload de justificatifs.
 * Stocke les fichiers dans Firebase Storage et retourne les métadonnées.
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
    'image/heic': ['.heic'],
};

function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} o`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

/**
 * @param {Object} props
 * @param {string} props.sourceType - "facture" | "depense"
 * @param {string} props.sourceId   - id du document parent
 * @param {Function} props.onUploaded - callback({ documentId, downloadURL, nom })
 */
export function FileUpload({ sourceType, sourceId, onUploaded }) {
    const { user } = useAuth();
    const [files, setFiles] = useState([]);      // fichiers en cours / terminés
    const [errors, setErrors] = useState([]);

    const onDrop = useCallback(
        async (acceptedFiles, rejected) => {
            setErrors(rejected.map((r) => `${r.file.name} : format non accepté`));

            for (const file of acceptedFiles) {
                const entry = { name: file.name, size: file.size, progress: 0, url: null, docId: null };
                setFiles((prev) => [...prev, entry]);

                const idx = files.length; // index local (approximatif  on utilise name comme clé)
                const storagePath = `justificatifs/${user.uid}/${Date.now()}_${file.name}`;
                const storageRef = ref(storage, storagePath);
                const uploadTask = uploadBytesResumable(storageRef, file);

                uploadTask.on(
                    'state_changed',
                    (snap) => {
                        const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
                        setFiles((prev) =>
                            prev.map((f) => (f.name === file.name ? { ...f, progress: pct } : f))
                        );
                    },
                    (err) => {
                        console.error(err);
                        setErrors((e) => [...e, `Erreur upload ${file.name}`]);
                    },
                    async () => {
                        const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
                        // Enregistrer métadonnées dans /documents
                        const docRef = await addDoc(collection(db, 'documents'), {
                            nom: file.name,
                            type: file.type.startsWith('image') ? 'image' : 'pdf',
                            storageRef: storagePath,
                            downloadURL,
                            taille: file.size,
                            sourceType,
                            sourceId: sourceId ?? null,
                            uploadedBy: user.uid,
                            createdAt: serverTimestamp(),
                        });
                        setFiles((prev) =>
                            prev.map((f) =>
                                f.name === file.name ? { ...f, progress: 100, url: downloadURL, docId: docRef.id } : f
                            )
                        );
                        onUploaded?.({ documentId: docRef.id, downloadURL, nom: file.name });
                    }
                );
            }
        },
        [user, sourceType, sourceId, onUploaded, files.length]
    );

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: ACCEPTED,
        multiple: true,
    });

    return (
        <div>
            <div {...getRootProps()} className={`dropzone ${isDragActive ? 'dropzone--active' : ''}`}>
                <input {...getInputProps()} />
                {isDragActive
                    ? ' Déposez les fichiers ici'
                    : ' Glissez-déposez vos justificatifs ici (PDF, JPG, PNG, HEIC), ou cliquez pour sélectionner'}
            </div>

            {errors.length > 0 && (
                <div className="notice notice--danger" style={{ marginTop: 8 }}>
                    {errors.map((e, i) => <div key={i}>{e}</div>)}
                </div>
            )}

            {files.length > 0 && (
                <div className="file-list">
                    {files.map((f) => (
                        <div key={f.name} className="file-item">
                            <span>{f.type === 'pdf' || f.name.endsWith('.pdf') ? '' : ''}</span>
                            <span className="file-item__name">{f.name}</span>
                            <span className="file-item__size">{formatSize(f.size)}</span>
                            {f.progress < 100
                                ? <span style={{ color: 'var(--accent)', fontSize: 12 }}>{f.progress}%</span>
                                : f.url && (
                                    <a href={f.url} target="_blank" rel="noreferrer" className="btn btn--sm btn--ghost">
                                        Voir
                                    </a>
                                )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
