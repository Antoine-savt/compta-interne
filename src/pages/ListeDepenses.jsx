/**
 * Liste des dépenses avec statut, montant, et détail comptable dépliable
 */
import { useState, useEffect } from 'react';
import { collection, query, orderBy, getDocs, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { ecrireEcriture } from '../services/api';
import { formatMontant, formatDate } from '../services/helpers';
import { DetailComptable } from '../components/DetailComptable';

export default function ListeDepenses() {
    const [depenses, setDepenses] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        getDocs(query(collection(db, 'depenses'), orderBy('createdAt', 'desc'))).then((snap) => {
            setDepenses(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
            setLoading(false);
        });
    }, []);

    async function marquerPayee(depense) {
        const today = new Date().toISOString().split('T')[0];
        const mvt = [
            { compte: '401', libelle: depense.fournisseurNom || 'Fournisseur', debit: depense.montant, credit: 0 },
            { compte: '512', libelle: 'Banque', debit: 0, credit: depense.montant },
        ];
        const { ecritureId } = await ecrireEcriture({
            journal: 'BQ', date: today,
            libelle: `Paiement ${depense.categorieLabel}  ${depense.fournisseurNom}`,
            sourceType: 'depense', sourceId: depense.id,
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

    if (loading) return <p style={{ color: 'var(--text-muted)' }}>Chargement</p>;

    return (
        <div>
            <div className="page-header">
                <h1>Dépenses</h1>
                <div className="page-header__actions">
                    <a href="/depenses/nouvelle" className="btn btn--primary">+ Nouvelle dépense</a>
                </div>
            </div>

            {depenses.length === 0 && (
                <div className="notice notice--info">Aucune dépense pour l'instant.</div>
            )}

            {depenses.map((d) => (
                <div key={d.id} className="card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                        <div>
                            <div style={{ fontWeight: 600, fontSize: 16 }}>
                                {d.categorieLabel}
                                {d.fournisseurNom && <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8 }}> {d.fournisseurNom}</span>}
                            </div>
                            <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 2 }}>
                                {formatDate(d.dateDépense)} · <strong style={{ color: 'var(--text)' }}>{formatMontant(d.montant)}</strong>
                                {d.clientProjetNom && <span className="badge badge--info" style={{ marginLeft: 8 }}>{d.clientProjetNom}</span>}
                                {d.recurrence?.type === 'recurrent' && <span className="badge badge--muted" style={{ marginLeft: 4 }}> Récurrent</span>}
                            </div>
                            {d.description && <div style={{ fontSize: 13, marginTop: 4 }}>{d.description}</div>}
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

                    <DetailComptable
                        ecritureIds={[...(d.ecritureDepenseIds ?? []), ...(d.ecriturePaiementIds ?? [])]}
                        sourceType="depense"
                    />
                </div>
            ))}
        </div>
    );
}
