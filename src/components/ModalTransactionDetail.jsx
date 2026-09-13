/**
 * ModalTransactionDetail.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Modal d'inspection détaillée d'une transaction / écriture comptable.
 * Accessible depuis le Grand Livre, l'Overview (flux récents) et l'historique.
 * 
 * Affiche :
 * - Date réelle et pièce de référence
 * - Journal et statut (active, contre-passée)
 * - Mouvements complets de la partie double (Débit / Crédit) avec équilibre
 * - Source métier (Dépense, Facture client, Apport CCA, Capital initial)
 * - Pièces jointes & justificatifs associés (téléchargement / prévisualisation)
 * - Upload direct d'une nouvelle pièce justificative a posteriori
 * - Possibilité de contre-passation (correction d'écriture)
 */

import { useState, useEffect, useCallback } from 'react';
import { doc, getDoc, collection, query, where, getDocs, updateDoc, arrayUnion } from 'firebase/firestore';
import { db } from '../firebase';
import { formatMontant, formatDate } from '../services/helpers';
import { getLibelleCompte, invalidateEcrituresCache } from '../services/comptaService';
import { contrepasser } from '../services/api';
import { FileUpload } from './FileUpload';

export function ModalTransactionDetail({ ecritureId, initialEcriture, onClose }) {
    const [ecriture, setEcriture] = useState(initialEcriture || null);
    const [sourceDoc, setSourceDoc] = useState(null);
    const [documents, setDocuments] = useState([]);
    const [loading, setLoading] = useState(!initialEcriture);
    const [loadingDocs, setLoadingDocs] = useState(true);
    const [showUpload, setShowUpload] = useState(false);

    // Contre-passation
    const [showContrepasser, setShowContrepasser] = useState(false);
    const [motifCorrection, setMotifCorrection] = useState('');
    const [correcting, setCorrecting] = useState(false);
    const [errorCorrection, setErrorCorrection] = useState('');
    const [successCorrection, setSuccessCorrection] = useState('');

    const targetId = ecritureId || initialEcriture?.id;

    // 1. Charger l'écriture
    const loadEcritureEtSource = useCallback(async () => {
        if (!targetId) return;
        try {
            let ecData = initialEcriture;
            if (!ecData || !ecData.mouvements) {
                const snap = await getDoc(doc(db, 'ecritures', targetId));
                if (snap.exists()) {
                    ecData = { id: snap.id, ...snap.data() };
                    setEcriture(ecData);
                }
            } else {
                setEcriture(ecData);
            }

            if (!ecData) return;

            // 2. Charger le document source s'il existe
            let srcDoc = null;
            const srcType = ecData.sourceType;
            const srcId = ecData.sourceId;

            if (srcType === 'depense' && srcId) {
                const dSnap = await getDoc(doc(db, 'depenses', srcId));
                if (dSnap.exists()) srcDoc = { id: dSnap.id, ...dSnap.data() };
            } else if ((srcType === 'facture' || srcType === 'facturation') && srcId) {
                let fSnap = await getDoc(doc(db, 'factures', srcId));
                if (!fSnap.exists()) {
                    fSnap = await getDoc(doc(db, 'facturations', srcId));
                }
                if (fSnap.exists()) srcDoc = { id: fSnap.id, ...fSnap.data() };
            } else if (srcType === 'facturation' && !srcId) {
                // Recherche dans facturations par ecritureFactId ou ecritureStripeId ou ecriturePaiementId
                const qFac1 = query(collection(db, 'facturations'), where('ecritureFactId', '==', targetId));
                const qSnap1 = await getDocs(qFac1);
                if (!qSnap1.empty) {
                    srcDoc = { id: qSnap1.docs[0].id, ...qSnap1.docs[0].data() };
                } else {
                    const qFac2 = query(collection(db, 'facturations'), where('ecritureStripeId', '==', targetId));
                    const qSnap2 = await getDocs(qFac2);
                    if (!qSnap2.empty) srcDoc = { id: qSnap2.docs[0].id, ...qSnap2.docs[0].data() };
                }
            } else if (srcType === 'cca_apport' || srcType === 'cca_remboursement') {
                // Trouver le mouvement CCA par ecritureId ou sourceId
                if (srcId) {
                    const mSnap = await getDoc(doc(db, 'ccaMouvements', srcId));
                    if (mSnap.exists()) srcDoc = { id: mSnap.id, ...mSnap.data() };
                } else {
                    const qCca = query(collection(db, 'ccaMouvements'), where('ecritureId', '==', targetId));
                    const cSnap = await getDocs(qCca);
                    if (!cSnap.empty) srcDoc = { id: cSnap.docs[0].id, ...cSnap.docs[0].data() };
                }
            }
            setSourceDoc(srcDoc);

            // 3. Charger les pièces jointes (documents)
            const docIds = new Set(srcDoc?.documentIds || []);
            const foundDocs = [];

            // A. Par IDs directs dans sourceDoc
            for (const dId of docIds) {
                const docSnap = await getDoc(doc(db, 'documents', dId));
                if (docSnap.exists()) foundDocs.push({ id: docSnap.id, ...docSnap.data() });
            }

            // B. Par sourceId == targetId ou sourceId == ecData.sourceId ou sourceId == srcDoc.id
            const idsToCheck = [targetId];
            if (ecData.sourceId) idsToCheck.push(ecData.sourceId);
            if (srcDoc?.id && !idsToCheck.includes(srcDoc.id)) idsToCheck.push(srcDoc.id);

            for (const idVal of idsToCheck) {
                const qDoc = query(collection(db, 'documents'), where('sourceId', '==', idVal));
                const dSnap = await getDocs(qDoc);
                dSnap.forEach((d) => {
                    if (!foundDocs.some((x) => x.id === d.id)) {
                        foundDocs.push({ id: d.id, ...d.data() });
                    }
                });
            }

            setDocuments(foundDocs);
        } catch (err) {
            console.error('Erreur chargement détail transaction:', err);
        } finally {
            setLoading(false);
            setLoadingDocs(false);
        }
    }, [targetId, initialEcriture]);

    useEffect(() => {
        loadEcritureEtSource();
    }, [loadEcritureEtSource]);

    // Callback après ajout d'une pièce jointe
    async function handleUploadedDocument({ documentId, downloadURL, nom }) {
        try {
            // Lier le document à l'écriture et à la source si elle existe
            await updateDoc(doc(db, 'documents', documentId), {
                sourceId: ecriture?.sourceId || targetId,
                ecritureId: targetId,
            });

            if (sourceDoc?.id) {
                const colName = ecriture?.sourceType === 'depense' ? 'depenses'
                    : ecriture?.sourceType === 'facture' ? 'factures'
                    : 'ccaMouvements';
                await updateDoc(doc(db, colName, sourceDoc.id), {
                    documentIds: arrayUnion(documentId),
                });
            }

            setDocuments((prev) => [...prev, {
                id: documentId,
                nom,
                downloadURL,
                type: nom.endsWith('.pdf') ? 'pdf' : 'image',
                createdAt: new Date(),
            }]);
            setShowUpload(false);
        } catch (e) {
            console.error('Erreur liaison justificatif:', e);
        }
    }

    // Contre-passation
    async function handleContrepasser() {
        if (!motifCorrection.trim()) {
            setErrorCorrection('Veuillez indiquer un motif de correction.');
            return;
        }
        setCorrecting(true);
        setErrorCorrection('');
        setSuccessCorrection('');
        try {
            const res = await contrepasser(targetId, motifCorrection.trim());
            setSuccessCorrection(`Écriture contre-passée avec succès (Réf: ${res.annulationId?.slice(0, 8)}).`);
            setEcriture((prev) => ({ ...prev, statut: 'annulee', annuleeLeDate: new Date() }));
            setShowContrepasser(false);
            invalidateEcrituresCache();
        } catch (err) {
            setErrorCorrection(err.message || 'Erreur lors de la contre-passation.');
        } finally {
            setCorrecting(false);
        }
    }

    if (!targetId) return null;

    // Calcul totaux débit / crédit de l'écriture
    const mouvements = ecriture?.mouvements || [];
    const totalDebit = mouvements.reduce((s, m) => s + (m.debit || 0), 0);
    const totalCredit = mouvements.reduce((s, m) => s + (m.credit || 0), 0);
    const estEquilibre = Math.abs(totalDebit - totalCredit) < 0.01;

    // Libellé de source clair
    let sourceLabel = 'Écriture diverse';
    if (ecriture?.sourceType === 'capital_initial') sourceLabel = '🏢 Dépôt de capital social initial';
    else if (ecriture?.sourceType === 'cca_apport') sourceLabel = '💼 Apport en compte courant d\'associé (CCA)';
    else if (ecriture?.sourceType === 'cca_remboursement') sourceLabel = '↩️ Remboursement compte courant associé';
    else if (ecriture?.sourceType === 'depense') sourceLabel = '🧾 Dépense d\'exploitation / Fournisseur';
    else if (ecriture?.sourceType === 'facture') sourceLabel = '📄 Facturation client';
    else if (ecriture?.sourceType === 'contrepassation') sourceLabel = '🔄 Contre-passation d\'annulation';

    return (
        <div style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(17, 24, 39, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16,
        }} onClick={onClose}>
            <div
                style={{
                    backgroundColor: 'var(--bg)',
                    borderRadius: 12,
                    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.1)',
                    border: '1px solid var(--border)',
                    width: '100%',
                    maxWidth: 720,
                    maxHeight: '90vh',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* ─── Header ─── */}
                <div style={{
                    padding: '16px 20px',
                    borderBottom: '1px solid var(--border)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: 'var(--bg2)',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 18 }}>🔍</span>
                        <div>
                            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text)' }}>
                                Détail de la transaction
                            </h2>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                                Réf. Écriture : <code>{targetId}</code>
                            </div>
                        </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span className={`badge ${ecriture?.statut === 'annulee' ? 'badge--danger' : 'badge--success'}`}>
                            {ecriture?.statut === 'annulee' ? 'Annulée' : 'Comptabilisée'}
                        </span>
                        <button
                            type="button"
                            onClick={onClose}
                            style={{
                                background: 'transparent',
                                border: 'none',
                                cursor: 'pointer',
                                fontSize: 18,
                                color: 'var(--text-muted)',
                                padding: '4px 8px',
                                borderRadius: 4,
                            }}
                        >
                            ✕
                        </button>
                    </div>
                </div>

                {/* ─── Body défilable ─── */}
                <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
                    {loading ? (
                        <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 40 }}>
                            Chargement des informations...
                        </p>
                    ) : (
                        <>
                            {successCorrection && <div className="notice notice--success" style={{ marginBottom: 16 }}>{successCorrection}</div>}
                            {errorCorrection && <div className="notice notice--danger" style={{ marginBottom: 16 }}>{errorCorrection}</div>}

                            {/* 1. Résumé de l'opération */}
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                                gap: 12,
                                background: 'var(--bg2)',
                                border: '1px solid var(--border)',
                                borderRadius: 8,
                                padding: 14,
                                marginBottom: 20,
                            }}>
                                <div>
                                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Date réelle</div>
                                    <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>
                                        {formatDate(ecriture?.date || ecriture?.dateObj)}
                                    </div>
                                </div>
                                <div>
                                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Journal</div>
                                    <div style={{ marginTop: 2 }}>
                                        <span className="badge badge--muted">{ecriture?.journal || 'BQ'}</span>
                                    </div>
                                </div>
                                <div>
                                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>N° de Pièce</div>
                                    <div style={{ fontSize: 13, marginTop: 2 }}>
                                        <code>{ecriture?.pieceRef || ecriture?.id?.slice(0, 6) || '—'}</code>
                                    </div>
                                </div>
                                <div>
                                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Nature / Source</div>
                                    <div style={{ fontSize: 13, fontWeight: 500, marginTop: 2 }}>
                                        {sourceLabel}
                                    </div>
                                </div>
                            </div>

                            {/* Libellé complet */}
                            <div style={{ marginBottom: 20 }}>
                                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Libellé complet :</div>
                                <div style={{
                                    fontSize: 14,
                                    fontWeight: 500,
                                    padding: '8px 12px',
                                    background: 'var(--bg3)',
                                    borderRadius: 6,
                                    border: '1px solid var(--border)',
                                }}>
                                    {ecriture?.libelle}
                                </div>
                            </div>

                            {/* 2. Tableau de la partie double (Débit / Crédit) */}
                            <div style={{ marginBottom: 24 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>
                                        Écriture comptable (Partie double)
                                    </div>
                                    <span style={{ fontSize: 12, color: estEquilibre ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>
                                        {estEquilibre ? '✓ Écriture équilibrée' : '⚠️ Écriture déséquilibrée'}
                                    </span>
                                </div>
                                <div className="table-wrap" style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
                                    <table style={{ margin: 0 }}>
                                        <thead>
                                            <tr style={{ background: 'var(--bg2)' }}>
                                                <th style={{ width: 80 }}>Compte</th>
                                                <th>Intitulé du compte</th>
                                                <th style={{ textAlign: 'right', width: 110 }}>Débit</th>
                                                <th style={{ textAlign: 'right', width: 110 }}>Crédit</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {mouvements.map((m, idx) => {
                                                const num = String(m.compte).trim();
                                                const intitule = m.libelle || getLibelleCompte(num);
                                                return (
                                                    <tr key={idx}>
                                                        <td><code>{num}</code></td>
                                                        <td style={{ fontSize: 13 }}>{intitule}</td>
                                                        <td style={{ textAlign: 'right', fontWeight: 500 }}>
                                                            {m.debit > 0 ? formatMontant(m.debit) : '—'}
                                                        </td>
                                                        <td style={{ textAlign: 'right', fontWeight: 500 }}>
                                                            {m.credit > 0 ? formatMontant(m.credit) : '—'}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                        <tfoot>
                                            <tr style={{ fontWeight: 700, background: 'var(--bg2)' }}>
                                                <td colSpan={2} style={{ textAlign: 'right' }}>Total :</td>
                                                <td style={{ textAlign: 'right' }}>{formatMontant(totalDebit)}</td>
                                                <td style={{ textAlign: 'right' }}>{formatMontant(totalCredit)}</td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            </div>

                            {/* 3. Pièces jointes & Justificatifs */}
                            <div style={{
                                border: '1px solid var(--border)',
                                borderRadius: 8,
                                padding: 16,
                                background: 'var(--bg2)',
                                marginBottom: 20,
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                                    <div style={{ fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <span>📎</span> Justificatifs & Pièces jointes ({documents.length})
                                    </div>
                                    <button
                                        type="button"
                                        className="btn btn--sm btn--ghost"
                                        onClick={() => setShowUpload(!showUpload)}
                                    >
                                        {showUpload ? 'Annuler l\'ajout' : '+ Ajouter un justificatif'}
                                    </button>
                                </div>

                                {loadingDocs ? (
                                    <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Recherche des justificatifs...</p>
                                ) : documents.length === 0 ? (
                                    <div style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic', padding: '8px 0' }}>
                                        Aucun document ou justificatif n'est actuellement lié à cette écriture.
                                    </div>
                                ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                        {documents.map((docItem) => (
                                            <div
                                                key={docItem.id}
                                                style={{
                                                    display: 'flex',
                                                    justifyContent: 'space-between',
                                                    alignItems: 'center',
                                                    background: 'var(--bg)',
                                                    border: '1px solid var(--border)',
                                                    borderRadius: 6,
                                                    padding: '8px 12px',
                                                }}
                                            >
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
                                                    <span>{docItem.type === 'pdf' || docItem.nom?.endsWith('.pdf') ? '📄' : '🖼️'}</span>
                                                    <span style={{ fontSize: 13, fontWeight: 500, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                                                        {docItem.nom}
                                                    </span>
                                                </div>
                                                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                                                    <a
                                                        href={docItem.downloadURL}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="btn btn--sm btn--primary"
                                                        style={{ fontSize: 12, padding: '4px 10px' }}
                                                    >
                                                        Ouvrir / Visualiser ↗
                                                    </a>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Zone d'upload supplémentaire si demandé */}
                                {showUpload && (
                                    <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px dashed var(--border)' }}>
                                        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--text)' }}>
                                            Déposez une facture, reçu ou attestation pour cette transaction :
                                        </div>
                                        <FileUpload
                                            sourceType={ecriture?.sourceType || 'depense'}
                                            sourceId={ecriture?.sourceId || targetId}
                                            onUploaded={handleUploadedDocument}
                                        />
                                    </div>
                                )}
                            </div>

                            {/* 4. Section Contre-passation / Correction (si besoin) */}
                            {ecriture?.statut === 'active' && (
                                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                                    {!showContrepasser ? (
                                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                            <button
                                                type="button"
                                                className="btn btn--sm btn--danger"
                                                onClick={() => setShowContrepasser(true)}
                                            >
                                                Corriger cette écriture (Contre-passer)
                                            </button>
                                        </div>
                                    ) : (
                                        <div style={{ background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: 8, padding: 14 }}>
                                            <div style={{ fontSize: 13, fontWeight: 600, color: '#9f1239', marginBottom: 6 }}>
                                                Annulation par contre-passation
                                            </div>
                                            <p style={{ fontSize: 12, color: '#4b5563', marginBottom: 10 }}>
                                                Conformément aux normes comptables, une écriture ne peut être supprimée. Une écriture miroir inversée va être générée pour annuler son impact.
                                            </p>
                                            <div className="form-group" style={{ marginBottom: 10 }}>
                                                <input
                                                    type="text"
                                                    className="form-input"
                                                    placeholder="Motif obligatoire (ex: Erreur de saisie de montant ou de date)"
                                                    value={motifCorrection}
                                                    onChange={(e) => setMotifCorrection(e.target.value)}
                                                />
                                            </div>
                                            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                                                <button
                                                    type="button"
                                                    className="btn btn--sm btn--ghost"
                                                    onClick={() => setShowContrepasser(false)}
                                                    disabled={correcting}
                                                >
                                                    Annuler
                                                </button>
                                                <button
                                                    type="button"
                                                    className="btn btn--sm btn--danger"
                                                    onClick={handleContrepasser}
                                                    disabled={correcting}
                                                >
                                                    {correcting ? 'Contre-passation...' : 'Confirmer l\'annulation'}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* ─── Footer ─── */}
                <div style={{
                    padding: '12px 20px',
                    borderTop: '1px solid var(--border)',
                    background: 'var(--bg2)',
                    display: 'flex',
                    justifyContent: 'flex-end',
                }}>
                    <button type="button" className="btn btn--primary" onClick={onClose}>
                        Fermer
                    </button>
                </div>
            </div>
        </div>
    );
}
