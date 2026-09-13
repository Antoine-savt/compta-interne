/**
 * Documents.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Gestion Électronique des Documents (GED) & Pièces Justificatives.
 * Centralise tous les reçus, factures d'achats, conventions de compte courant,
 * attestations bancaires et statuts enregistrés dans l'application.
 * 
 * Fonctionnalités :
 * - Vue d'ensemble avec métriques (total, dépenses, factures, CCA)
 * - Filtres par nature d'opération et recherche textuelle
 * - Téléversement direct de justificatifs
 * - Prévisualisation intégrée (images et PDF)
 * - Accès direct à la modification de l'opération liée (Dépense, CCA, Facture)
 * - Téléchargement et suppression
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { collection, query, orderBy, getDocs, doc, deleteDoc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { FileUpload } from '../components/FileUpload';
import { ModalModifierOperation } from '../components/ModalModifierOperation';
import { formatDate } from '../services/helpers';

function formatSize(bytes) {
    if (!bytes || bytes <= 0) return '—';
    if (bytes < 1024) return `${bytes} o`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export default function Documents() {
    const [documents, setDocuments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filtreType, setFiltreType] = useState('tous'); // 'tous' | 'depense' | 'facture' | 'cca' | 'capital'
    const [recherche, setRecherche] = useState('');
    const [previewDoc, setPreviewDoc] = useState(null);
    const [editOperation, setEditOperation] = useState(null); // { ecritureId, sourceId, sourceType }
    const [operationsMap, setOperationsMap] = useState({}); // sourceId -> { label, montant, date }

    const loadDocuments = useCallback(async () => {
        setLoading(true);
        try {
            const q = query(collection(db, 'documents'), orderBy('createdAt', 'desc'));
            const snap = await getDocs(q);
            const docsList = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
            setDocuments(docsList);

            // Charger les détails des opérations liées en tâche de fond
            const ops = {};
            for (const item of docsList) {
                const sId = item.sourceId;
                const sType = item.sourceType;
                if (!sId || ops[sId]) continue;

                try {
                    if (sType === 'depense') {
                        const sSnap = await getDoc(doc(db, 'depenses', sId));
                        if (sSnap.exists()) {
                            const data = sSnap.data();
                            ops[sId] = {
                                label: `Dépense [${data.activiteLabel || 'Wheeloh'}] ${data.fournisseurNom || ''} (${data.categorieLabel || ''})`,
                                montant: data.montant,
                                date: data.dateDépense,
                                type: 'depense',
                            };
                        }
                    } else if (sType?.startsWith('cca')) {
                        const sSnap = await getDoc(doc(db, 'ccaMouvements', sId));
                        if (sSnap.exists()) {
                            const data = sSnap.data();
                            ops[sId] = {
                                label: `CCA ${data.associeNom || ''} — ${data.type === 'apport' ? 'Apport' : 'Remboursement'}`,
                                montant: data.montant,
                                date: data.dateMouvement,
                                type: 'cca',
                            };
                        }
                    } else if (sType === 'facture') {
                        const sSnap = await getDoc(doc(db, 'factures', sId));
                        if (sSnap.exists()) {
                            const data = sSnap.data();
                            ops[sId] = {
                                label: `Facture ${data.numero || ''} — ${data.clientNom || ''}`,
                                montant: data.totalTTC,
                                date: data.date,
                                type: 'facture',
                            };
                        }
                    }
                } catch (e) {
                    console.warn('Erreur chargement métadonnées opération :', e);
                }
            }
            setOperationsMap(ops);
        } catch (err) {
            console.error('Erreur chargement documents :', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadDocuments();
    }, [loadDocuments]);

    // Filtrage
    const docsFiltres = useMemo(() => {
        return documents.filter((d) => {
            if (filtreType !== 'tous') {
                if (filtreType === 'cca') {
                    if (!d.sourceType?.startsWith('cca')) return false;
                } else if (d.sourceType !== filtreType) {
                    return false;
                }
            }
            if (recherche.trim()) {
                const q = recherche.toLowerCase();
                const op = operationsMap[d.sourceId];
                const matchNom = (d.nom || '').toLowerCase().includes(q);
                const matchOp = (op?.label || '').toLowerCase().includes(q);
                if (!matchNom && !matchOp) return false;
            }
            return true;
        });
    }, [documents, filtreType, recherche, operationsMap]);

    // Métriques
    const totalDocs = documents.length;
    const totalDepenses = documents.filter((d) => d.sourceType === 'depense').length;
    const totalCCA = documents.filter((d) => d.sourceType?.startsWith('cca')).length;
    const totalFactures = documents.filter((d) => d.sourceType === 'facture').length;

    async function handleDeleteDoc(d) {
        if (!window.confirm(`Supprimer la pièce justificative "${d.nom}" ? Cette action est irréversible.`)) {
            return;
        }
        try {
            await deleteDoc(doc(db, 'documents', d.id));
            setDocuments((prev) => prev.filter((x) => x.id !== d.id));
        } catch (err) {
            alert('Erreur suppression : ' + err.message);
        }
    }

    return (
        <div>
            {/* Header */}
            <div className="page-header">
                <div>
                    <h1>Pièces justificatives & GED</h1>
                    <p>Gestion Électronique des Documents : reçus, factures d'achats, conventions CCA, attestations bancaires</p>
                </div>
                <div className="page-header__actions">
                    <button className="btn btn--ghost" onClick={loadDocuments}>
                        Actualiser
                    </button>
                </div>
            </div>

            {/* Avertissement & Traçabilité légale */}
            <div className="notice notice--info" style={{ marginBottom: 20 }}>
                <strong>Conservation légale :</strong> Les pièces justificatives comptables doivent être conservées pendant 10 ans (article L123-22 du Code de commerce). Chaque document est sauvegardé de manière sécurisée et directement rattaché à son écriture comptable.
            </div>

            {/* Cartes KPI */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
                <div className="card" style={{ padding: '16px 20px', marginBottom: 0 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
                        Total pièces archivées
                    </div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--accent)' }}>
                        {totalDocs}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Documents en base</div>
                </div>

                <div className="card" style={{ padding: '16px 20px', marginBottom: 0 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
                        Justificatifs de dépenses
                    </div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)' }}>
                        {totalDepenses}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Reçus et factures d'achat</div>
                </div>

                <div className="card" style={{ padding: '16px 20px', marginBottom: 0 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
                        Justificatifs CCA
                    </div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--success)' }}>
                        {totalCCA}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Conventions & avis d'apport</div>
                </div>

                <div className="card" style={{ padding: '16px 20px', marginBottom: 0 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
                        Factures clients
                    </div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--info)' }}>
                        {totalFactures}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Devis & factures émises</div>
                </div>
            </div>

            {/* Zone d'upload direct */}
            <div className="card" style={{ marginBottom: 20 }}>
                <div className="card__title">Déposer un nouveau justificatif</div>
                <FileUpload
                    sourceType="general"
                    onUploaded={() => {
                        loadDocuments();
                    }}
                />
            </div>

            {/* Barre de filtres et recherche */}
            <div className="card" style={{ padding: '14px 20px', marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button
                            className={`btn btn--sm ${filtreType === 'tous' ? 'btn--primary' : 'btn--ghost'}`}
                            onClick={() => setFiltreType('tous')}
                        >
                            Tous ({documents.length})
                        </button>
                        <button
                            className={`btn btn--sm ${filtreType === 'depense' ? 'btn--primary' : 'btn--ghost'}`}
                            onClick={() => setFiltreType('depense')}
                        >
                            Dépenses ({totalDepenses})
                        </button>
                        <button
                            className={`btn btn--sm ${filtreType === 'cca' ? 'btn--primary' : 'btn--ghost'}`}
                            onClick={() => setFiltreType('cca')}
                        >
                            Comptes Courants CCA ({totalCCA})
                        </button>
                        <button
                            className={`btn btn--sm ${filtreType === 'facture' ? 'btn--primary' : 'btn--ghost'}`}
                            onClick={() => setFiltreType('facture')}
                        >
                            Factures ({totalFactures})
                        </button>
                    </div>

                    <div style={{ flex: '1 1 240px', maxWidth: 350 }}>
                        <input
                            type="text"
                            placeholder="Rechercher par nom de fichier ou opération..."
                            className="form-input"
                            value={recherche}
                            onChange={(e) => setRecherche(e.target.value)}
                        />
                    </div>
                </div>
            </div>

            {/* Liste des documents */}
            {loading ? (
                <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                    Chargement des pièces justificatives...
                </div>
            ) : docsFiltres.length === 0 ? (
                <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                    {documents.length === 0
                        ? 'Aucune pièce justificative enregistrée pour le moment. Vous pouvez glisser-déposer vos reçus ci-dessus.'
                        : 'Aucun document ne correspond aux filtres sélectionnés.'}
                </div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16, marginBottom: 24 }}>
                    {docsFiltres.map((d) => {
                        const fileUrl = d.downloadURL || d.dataUrl;
                        const isImage = d.type === 'image' || d.mimeType?.startsWith('image');
                        const opLiee = operationsMap[d.sourceId];

                        return (
                            <div
                                key={d.id}
                                className="card"
                                style={{
                                    padding: 0,
                                    overflow: 'hidden',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    border: '1px solid var(--border)',
                                    transition: 'transform 0.15s, box-shadow 0.15s',
                                }}
                            >
                                {/* Zone d'aperçu */}
                                <div
                                    style={{
                                        height: 140,
                                        background: 'var(--bg3)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        position: 'relative',
                                        overflow: 'hidden',
                                        cursor: fileUrl ? 'pointer' : 'default',
                                    }}
                                    onClick={() => fileUrl && setPreviewDoc(d)}
                                    title="Cliquer pour agrandir"
                                >
                                    {isImage && fileUrl ? (
                                        <img
                                            src={fileUrl}
                                            alt={d.nom}
                                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                        />
                                    ) : (
                                        <div style={{ textAlign: 'center' }}>
                                            <div style={{ display: 'inline-block', padding: '8px 16px', background: '#fee2e2', color: '#b91c1c', fontWeight: 800, fontSize: 14, borderRadius: 6, letterSpacing: '1px' }}>
                                                PDF
                                            </div>
                                            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginTop: 4 }}>
                                                DOCUMENT
                                            </div>
                                        </div>
                                    )}

                                    <span
                                        className="badge"
                                        style={{
                                            position: 'absolute',
                                            top: 8,
                                            right: 8,
                                            background: 'rgba(0,0,0,0.65)',
                                            color: '#fff',
                                            fontSize: 10,
                                            backdropFilter: 'blur(4px)',
                                        }}
                                    >
                                        {formatSize(d.taille)}
                                    </span>
                                </div>

                                {/* Contenu & Métadonnées */}
                                <div style={{ padding: '12px 14px', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                                    <div>
                                        <div
                                            style={{
                                                fontSize: 13,
                                                fontWeight: 700,
                                                color: 'var(--text)',
                                                whiteSpace: 'nowrap',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                marginBottom: 4,
                                            }}
                                            title={d.nom}
                                        >
                                            {d.nom}
                                        </div>

                                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                                            Ajouté le {formatDate(d.createdAt?.toDate ? d.createdAt.toDate() : d.createdAt || new Date())}
                                        </div>

                                        {/* Opération liée */}
                                        {opLiee ? (
                                            <div
                                                style={{
                                                    fontSize: 11,
                                                    background: 'var(--bg2)',
                                                    border: '1px solid var(--border)',
                                                    borderRadius: 4,
                                                    padding: '6px 8px',
                                                    marginBottom: 10,
                                                }}
                                            >
                                                <div style={{ color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase' }}>
                                                    Opération liée :
                                                </div>
                                                <div style={{ fontWeight: 600, color: 'var(--text)', marginTop: 2 }}>
                                                    {opLiee.label}
                                                </div>
                                            </div>
                                        ) : (
                                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10, fontStyle: 'italic' }}>
                                                Non rattaché à une écriture spécifique
                                            </div>
                                        )}
                                    </div>

                                    {/* Boutons d'actions */}
                                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 4 }}>
                                        {fileUrl && (
                                            <button
                                                className="btn btn--sm btn--ghost"
                                                style={{ fontSize: 11, padding: '3px 8px', flex: 1 }}
                                                onClick={() => setPreviewDoc(d)}
                                            >
                                                Aperçu
                                            </button>
                                        )}
                                        {fileUrl && (
                                            <a
                                                href={fileUrl}
                                                download={d.nom}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="btn btn--sm btn--ghost"
                                                style={{ fontSize: 11, padding: '3px 8px' }}
                                                title="Télécharger le fichier"
                                            >
                                                Télécharger
                                            </a>
                                        )}
                                        {d.sourceId && (
                                            <button
                                                className="btn btn--sm btn--ghost"
                                                style={{ fontSize: 11, padding: '3px 8px' }}
                                                title="Modifier l'opération comptable liée"
                                                onClick={() => setEditOperation({ sourceId: d.sourceId, sourceType: d.sourceType })}
                                            >
                                                Modifier
                                            </button>
                                        )}
                                        <button
                                            className="btn btn--sm btn--ghost"
                                            style={{ fontSize: 11, padding: '3px 8px', color: 'var(--danger)' }}
                                            title="Supprimer la pièce justificative"
                                            onClick={() => handleDeleteDoc(d)}
                                        >
                                            Supprimer
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Modal d'aperçu plein écran */}
            {previewDoc && (
                <div
                    style={{
                        position: 'fixed',
                        inset: 0,
                        backgroundColor: 'rgba(0, 0, 0, 0.75)',
                        backdropFilter: 'blur(4px)',
                        zIndex: 1000,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 20,
                    }}
                    onClick={() => setPreviewDoc(null)}
                >
                    <div
                        style={{
                            background: 'var(--bg)',
                            borderRadius: 10,
                            maxWidth: '90vw',
                            maxHeight: '90vh',
                            display: 'flex',
                            flexDirection: 'column',
                            overflow: 'hidden',
                            boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div
                            style={{
                                padding: '12px 18px',
                                borderBottom: '1px solid var(--border)',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                background: 'var(--bg2)',
                            }}
                        >
                            <span style={{ fontWeight: 700, fontSize: 14 }}>
                                {previewDoc.nom} ({formatSize(previewDoc.taille)})
                            </span>
                            <div style={{ display: 'flex', gap: 10 }}>
                                <a
                                    href={previewDoc.downloadURL || previewDoc.dataUrl}
                                    download={previewDoc.nom}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="btn btn--sm btn--ghost"
                                >
                                    Télécharger
                                </a>
                                <button className="btn btn--sm btn--ghost" onClick={() => setPreviewDoc(null)}>
                                    Fermer
                                </button>
                            </div>
                        </div>

                        <div style={{ padding: 16, overflowY: 'auto', textAlign: 'center', minWidth: 320, minHeight: 300 }}>
                            {previewDoc.type === 'image' || previewDoc.mimeType?.startsWith('image') ? (
                                <img
                                    src={previewDoc.downloadURL || previewDoc.dataUrl}
                                    alt={previewDoc.nom}
                                    style={{ maxWidth: '100%', maxHeight: '75vh', objectFit: 'contain', borderRadius: 4 }}
                                />
                            ) : (
                                <iframe
                                    src={previewDoc.downloadURL || previewDoc.dataUrl}
                                    title={previewDoc.nom}
                                    style={{ width: '80vw', height: '75vh', border: 'none' }}
                                />
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Modal de modification de l'opération liée */}
            {editOperation && (
                <ModalModifierOperation
                    sourceId={editOperation.sourceId}
                    sourceType={editOperation.sourceType}
                    onClose={() => setEditOperation(null)}
                    onSaved={() => {
                        setEditOperation(null);
                        loadDocuments();
                    }}
                />
            )}
        </div>
    );
}
