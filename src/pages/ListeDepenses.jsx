/**
 * ListeDepenses.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Liste des dépenses avec ventilation par activité (Wheeloh vs site-chateau.fr vs Commun),
 * filtrage rapide, pièces jointes attachées et modal de détail comptable.
 */
import { useState, useEffect, useMemo } from 'react';
import { collection, query, orderBy, getDocs, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { ecrireEcriture } from '../services/api';
import { formatMontant, formatDate } from '../services/helpers';
import { DetailComptable } from '../components/DetailComptable';
import { ModalModifierOperation } from '../components/ModalModifierOperation';
import { getCached, setCached } from '../services/dataCache';

export default function ListeDepenses() {
    const [depenses, setDepenses] = useState(() => getCached('depenses') || []);
    const [documents, setDocuments] = useState([]);
    const [loading, setLoading] = useState(() => !getCached('depenses'));
    const [filtreActivite, setFiltreActivite] = useState('tous'); // 'tous' | 'wheeloh' | 'site-chateau' | 'commun'
    const [selectedOperation, setSelectedOperation] = useState(null);

    const loadDepenses = () => {
        Promise.all([
            getDocs(query(collection(db, 'depenses'), orderBy('createdAt', 'desc'))),
            getDocs(collection(db, 'documents')),
        ]).then(([dSnap, docSnap]) => {
            const list = dSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
            const docsList = docSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
            setDepenses(list);
            setDocuments(docsList);
            setCached('depenses', list);
            setLoading(false);
        });
    };

    useEffect(() => {
        loadDepenses();
    }, []);

    async function marquerPayee(depense) {
        const today = new Date().toISOString().split('T')[0];
        const mvt = [
            { compte: '401', libelle: depense.fournisseurNom || 'Fournisseur', debit: depense.montant, credit: 0 },
            { compte: '512', libelle: 'Banque', debit: 0, credit: depense.montant },
        ];
        const actTag = depense.activite === 'site-chateau' ? 'site-chateau.fr' : depense.activite === 'commun' ? 'Commun' : 'Wheeloh';
        const { ecritureId } = await ecrireEcriture({
            journal: 'BQ',
            date: today,
            libelle: `Paiement [${actTag}] ${depense.categorieLabel} — ${depense.fournisseurNom}`,
            sourceType: 'depense',
            sourceId: depense.id,
            mouvements: mvt,
        });
        await updateDoc(doc(db, 'depenses', depense.id), {
            statut: 'payee',
            datePaiement: new Date(today),
            ecriturePaiementIds: [...(depense.ecriturePaiementIds ?? []), ecritureId],
            updatedAt: serverTimestamp(),
        });
        setDepenses((prev) => prev.map((d) => d.id === depense.id ? { ...d, statut: 'payee' } : d));
    }

    const statusBadge = (s) => {
        if (s === 'payee') return <span className="badge badge--success">Payée</span>;
        if (s === 'annulee') return <span className="badge badge--danger">Annulée</span>;
        return <span className="badge badge--warning">À payer</span>;
    };

    const activiteBadge = (act) => {
        if (act === 'site-chateau') {
            return (
                <span className="badge" style={{ background: '#f3e8ff', color: '#6b21a8', border: '1px solid #e9d5ff', fontWeight: 600 }}>
                    🏰 site-chateau.fr
                </span>
            );
        }
        if (act === 'commun') {
            return (
                <span className="badge badge--muted" style={{ fontWeight: 600 }}>
                    🏢 Commun
                </span>
            );
        }
        // Par défaut wheeloh
        return (
            <span className="badge badge--info" style={{ background: '#dbeafe', color: '#1e40af', fontWeight: 600 }}>
                🚲 Wheeloh
            </span>
        );
    };

    // Calculs analytiques par activité
    const totauxActivites = useMemo(() => {
        let totalWheeloh = 0;
        let totalSiteChateau = 0;
        let totalCommun = 0;

        depenses.forEach((d) => {
            const m = d.montant || 0;
            if (d.activite === 'site-chateau') totalSiteChateau += m;
            else if (d.activite === 'commun') totalCommun += m;
            else totalWheeloh += m; // default wheeloh
        });

        const totalGlobal = totalWheeloh + totalSiteChateau + totalCommun;
        return {
            wheeloh: +totalWheeloh.toFixed(2),
            siteChateau: +totalSiteChateau.toFixed(2),
            commun: +totalCommun.toFixed(2),
            totalGlobal: +totalGlobal.toFixed(2),
        };
    }, [depenses]);

    // Filtrage par activité
    const depensesFiltrees = useMemo(() => {
        if (filtreActivite === 'tous') return depenses;
        if (filtreActivite === 'wheeloh') return depenses.filter((d) => !d.activite || d.activite === 'wheeloh');
        return depenses.filter((d) => d.activite === filtreActivite);
    }, [depenses, filtreActivite]);

    if (loading) return <p style={{ color: 'var(--text-muted)', padding: 20 }}>Chargement des dépenses...</p>;

    return (
        <div>
            <div className="page-header">
                <div>
                    <h1>Dépenses</h1>
                    <p>Suivi des charges d'exploitation, ventilation par activité et pièces justificatives</p>
                </div>
                <div className="page-header__actions">
                    <a href="/depenses/nouvelle" className="btn btn--primary">+ Nouvelle dépense</a>
                </div>
            </div>

            {/* ─── Synthèse analytique rapide ─── */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: 12,
                marginBottom: 20,
            }}>
                <div className="card" style={{ padding: '12px 16px', borderLeft: '4px solid #2563eb' }}>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>🚲 Dépenses Wheeloh</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginTop: 4 }}>
                        {formatMontant(totauxActivites.wheeloh)}
                    </div>
                </div>
                <div className="card" style={{ padding: '12px 16px', borderLeft: '4px solid #9333ea' }}>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>🏰 Dépenses site-chateau.fr</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginTop: 4 }}>
                        {formatMontant(totauxActivites.siteChateau)}
                    </div>
                </div>
                <div className="card" style={{ padding: '12px 16px', borderLeft: '4px solid var(--text-muted)' }}>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>🏢 Frais généraux / Commun</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginTop: 4 }}>
                        {formatMontant(totauxActivites.commun)}
                    </div>
                </div>
            </div>

            {/* ─── Barre de filtres par activité ─── */}
            <div className="card" style={{ padding: '10px 16px', marginBottom: 16, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginRight: 4 }}>
                    Filtrer par activité :
                </span>
                {[
                    { id: 'tous', label: `Toutes (${depenses.length})` },
                    { id: 'wheeloh', label: `🚲 Wheeloh` },
                    { id: 'site-chateau', label: `🏰 site-chateau.fr` },
                    { id: 'commun', label: `🏢 Frais communs` },
                ].map((f) => (
                    <button
                        key={f.id}
                        type="button"
                        className={`btn btn--sm ${filtreActivite === f.id ? 'btn--primary' : 'btn--ghost'}`}
                        onClick={() => setFiltreActivite(f.id)}
                    >
                        {f.label}
                    </button>
                ))}
            </div>

            {depensesFiltrees.length === 0 && (
                <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                    Aucune dépense trouvée pour ce filtre.
                </div>
            )}

            {depensesFiltrees.map((d) => {
                // Trouver les justificatifs liés
                const docsLiees = documents.filter((docItem) =>
                    docItem.sourceId === d.id || (d.documentIds && d.documentIds.includes(docItem.id))
                );

                return (
                    <div key={d.id} className="card" style={{ marginBottom: 14 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                            <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                    <span style={{ fontWeight: 700, fontSize: 16 }}>{d.categorieLabel}</span>
                                    {activiteBadge(d.activite)}
                                    {d.fournisseurNom && (
                                        <span style={{ fontWeight: 500, color: 'var(--text-muted)', fontSize: 14 }}>
                                            · {d.fournisseurNom}
                                        </span>
                                    )}
                                </div>
                                <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
                                    {formatDate(d.dateDépense)} · <strong style={{ color: 'var(--text)', fontSize: 15 }}>{formatMontant(d.montant)}</strong>
                                    {d.clientProjetNom && <span className="badge badge--info" style={{ marginLeft: 8 }}>{d.clientProjetNom}</span>}
                                    {d.recurrence?.type === 'recurrent' && <span className="badge badge--muted" style={{ marginLeft: 4 }}>Récurrent</span>}
                                </div>
                                {d.description && <div style={{ fontSize: 13, marginTop: 4 }}>{d.description}</div>}

                                {/* Pièces jointes directes */}
                                {docsLiees.length > 0 && (
                                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                                        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>📎 Pièce(s) jointe(s) :</span>
                                        {docsLiees.map((docItem) => (
                                            <a
                                                key={docItem.id}
                                                href={docItem.downloadURL}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="btn btn--sm btn--ghost"
                                                style={{ fontSize: 11, padding: '2px 8px' }}
                                            >
                                                📄 {docItem.nom} ↗
                                            </a>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                                {statusBadge(d.statut)}
                                {d.statut === 'a_payer' && (
                                    <button className="btn btn--sm btn--primary" onClick={() => marquerPayee(d)}>
                                        Marquer comme payée
                                    </button>
                                )}
                            </div>
                        </div>

                        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <DetailComptable
                                ecritureIds={[...(d.ecritureDepenseIds ?? []), ...(d.ecriturePaiementIds ?? [])]}
                                sourceType="depense"
                            />
                            <button
                                type="button"
                                style={{
                                    background: 'transparent',
                                    border: 'none',
                                    cursor: 'pointer',
                                    fontSize: 18,
                                    color: 'var(--text-muted)',
                                    padding: '2px 8px',
                                    borderRadius: 4,
                                    lineHeight: 1,
                                }}
                                onClick={() => setSelectedOperation({ sourceId: d.id, sourceType: 'depense', ecritureId: d.ecritureDepenseIds?.[0] })}
                                title="Options (Modifier)"
                            >
                                ⋮
                            </button>
                        </div>
                    </div>
                );
            })}

            {/* Modal de modification de dépense */}
            {selectedOperation && (
                <ModalModifierOperation
                    sourceId={selectedOperation.sourceId}
                    sourceType="depense"
                    ecritureId={selectedOperation.ecritureId}
                    onClose={() => setSelectedOperation(null)}
                    onSaved={() => {
                        setSelectedOperation(null);
                        loadDepenses();
                    }}
                />
            )}
        </div>
    );
}
