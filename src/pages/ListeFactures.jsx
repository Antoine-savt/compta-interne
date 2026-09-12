/**
 * Liste des factures avec statut, total, et détail comptable dépliable
 */
import { useState, useEffect } from 'react';
import { collection, query, orderBy, getDocs, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { ecrireEcriture } from '../services/api';
import { formatMontant, formatDate } from '../services/helpers';
import { DetailComptable } from '../components/DetailComptable';
import { getCached, setCached } from '../services/dataCache';

export default function ListeFactures() {
    const [factures, setFactures] = useState(() => getCached('factures') || []);
    const [loading, setLoading] = useState(() => !getCached('factures'));

    useEffect(() => {
        getDocs(query(collection(db, 'factures'), orderBy('createdAt', 'desc'))).then((snap) => {
            const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
            setFactures(list);
            setCached('factures', list);
            setLoading(false);
        });
    }, []);

    async function marquerPayee(facture) {
        const today = new Date().toISOString().split('T')[0];
        // Écriture BQ
        const mvt = [
            { compte: '512', libelle: 'Banque', debit: facture.totalTTC, credit: 0 },
            { compte: '411', libelle: facture.clientNom || 'Client', debit: 0, credit: facture.totalTTC },
        ];
        const { ecritureId } = await ecrireEcriture({
            journal: 'BQ', date: today,
            libelle: `Encaissement facture ${facture.numero}  ${facture.clientNom}`,
            pieceRef: facture.numero, sourceType: 'facture', sourceId: facture.id,
            mouvements: mvt,
        });
        await updateDoc(doc(db, 'factures', facture.id), {
            statut: 'encaissee',
            dateEncaissement: new Date(today),
            ecritureEncaissIds: [...(facture.ecritureEncaissIds ?? []), ecritureId],
            updatedAt: serverTimestamp(),
        });
        setFactures((prev) => prev.map((f) => f.id === facture.id ? { ...f, statut: 'encaissee' } : f));
    }

    const statusBadge = (s) => {
        if (s === 'encaissee') return <span className="badge badge--success">Encaissée</span>;
        if (s === 'annulee') return <span className="badge badge--danger">Annulée</span>;
        return <span className="badge badge--warning">En attente</span>;
    };

    if (loading) return <p style={{ color: 'var(--text-muted)' }}>Chargement</p>;

    return (
        <div>
            <div className="page-header">
                <h1>Factures</h1>
                <div className="page-header__actions">
                    <a href="/factures/nouvelle" className="btn btn--primary">+ Nouvelle facture</a>
                </div>
            </div>

            {factures.length === 0 && (
                <div className="notice notice--info">Aucune facture pour l'instant.</div>
            )}

            {factures.map((f) => (
                <div key={f.id} className="card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                        <div>
                            <div style={{ fontWeight: 600, fontSize: 16 }}>{f.numero}  {f.clientNom}</div>
                            <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 2 }}>
                                {formatDate(f.dateFacture)} · {formatMontant(f.totalTTC)}
                                {f.tvaApplicable && <span style={{ marginLeft: 8 }}>TVA {f.tauxTVA}%</span>}
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                            {statusBadge(f.statut)}
                            {f.statut === 'en_attente' && (
                                <button className="btn btn--sm btn--primary" onClick={() => marquerPayee(f)}>
                                    Marquer comme encaissée
                                </button>
                            )}
                        </div>
                    </div>

                    <DetailComptable
                        ecritureIds={[...(f.ecritureVenteIds ?? []), ...(f.ecritureEncaissIds ?? [])]}
                        sourceType="facture"
                    />
                </div>
            ))}
        </div>
    );
}
