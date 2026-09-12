/**
 * FicheAssocie.jsx
 * Fiche individuelle d'un associé :
 * - Métriques compte courant CCA complètes (Apports, Avances frais, Remboursements, Intérêts, Solde total)
 * - Historique des mouvements CCA avec pièces justificatives
 * - Historique avances de frais
 * - Historique dividendes
 * - Accès rapide au simulateur d'intérêts et nouveaux mouvements
 */
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    doc, getDoc, getDocs, collection, query, where, orderBy,
    updateDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { ecrireEcriture } from '../services/api';
import { formatMontant, formatDate } from '../services/helpers';
import { getCached, setCached } from '../services/dataCache';

const ROLES = {
    president: 'Président',
    associe: 'Associé',
    president_associe: 'Président & Associé',
};

export default function FicheAssocie() {
    const { associeId } = useParams();
    const navigate = useNavigate();

    const [associe, setAssocie] = useState(() => {
        const cached = getCached('associes');
        return cached?.find((a) => a.id === associeId) || null;
    });
    const [avances, setAvances] = useState([]);
    const [dividendes, setDividendes] = useState([]);
    const [ccaMouvements, setCcaMouvements] = useState([]);
    const [documents, setDocuments] = useState([]);
    const [loading, setLoading] = useState(() => {
        const cached = getCached('associes');
        return !cached?.some((a) => a.id === associeId);
    });
    const [saving, setSaving] = useState('');

    const load = useCallback(async () => {
        try {
            const [assSnap, avSnap, divSnap, ccaSnap, docSnap] = await Promise.all([
                getDoc(doc(db, 'associes', associeId)),
                getDocs(query(collection(db, 'avancesFrags'), where('associeId', '==', associeId), orderBy('dateAvance', 'desc'))),
                getDocs(query(collection(db, 'dividendes'), where('associeId', '==', associeId), orderBy('dateDecisionAG', 'desc'))),
                getDocs(query(collection(db, 'ccaMouvements'), where('associeId', '==', associeId), orderBy('dateMouvement', 'desc'))),
                getDocs(collection(db, 'documents')),
            ]);

            if (!assSnap.exists()) { navigate('/associes'); return; }
            setAssocie({ id: assSnap.id, ...assSnap.data() });
            setAvances(avSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
            setDividendes(divSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
            setCcaMouvements(ccaSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
            setDocuments(docSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        } catch (err) {
            console.error('Erreur chargement fiche associé:', err);
        } finally {
            setLoading(false);
        }
    }, [associeId, navigate]);

    useEffect(() => {
        load();
    }, [load]);

    // Métriques des avances de frais
    const totalAvances = avances
        .filter((a) => a.statut !== 'annule')
        .reduce((s, a) => s + a.montant, 0);
    const totalRemboursesAvances = avances
        .filter((a) => a.statut === 'rembourse')
        .reduce((s, a) => s + a.montant, 0);
    const soldeAvances = totalAvances - totalRemboursesAvances;

    // Métriques des mouvements CCA directs
    const totalApportsCCA = ccaMouvements
        .filter((m) => m.type === 'apport')
        .reduce((s, m) => s + (m.montant || 0), 0);
    const totalRemboursesCCA = ccaMouvements
        .filter((m) => m.type === 'remboursement')
        .reduce((s, m) => s + (m.montant || 0), 0);
    const totalInteretsCCA = ccaMouvements
        .filter((m) => m.type === 'interets')
        .reduce((s, m) => s + (m.montant || 0), 0);

    // Solde total global du compte courant (apports + avances non remboursées + intérêts - remboursements CCA)
    const soldeTotalCCA = +(totalApportsCCA + soldeAvances + totalInteretsCCA - totalRemboursesCCA).toFixed(2);

    /** Remboursement d'une avance de frais : Débit 455x / Crédit 512 */
    async function rembourserAvance(avance) {
        if (!window.confirm(`Enregistrer le remboursement de ${formatMontant(avance.montant)} à ${associe.nom} ?`)) return;
        setSaving(avance.id);
        try {
            const today = new Date().toISOString().split('T')[0];
            const { ecritureId } = await ecrireEcriture({
                journal: 'BQ',
                date: today,
                libelle: `Remboursement avance frais — ${associe.nom} — ${avance.description}`,
                sourceType: 'avance_frais',
                sourceId: avance.id,
                mouvements: [
                    { compte: associe.compteCC || '455', libelle: `Compte courant ${associe.nom}`, debit: avance.montant, credit: 0 },
                    { compte: '512', libelle: 'Banque', debit: 0, credit: avance.montant },
                ],
            });
            await updateDoc(doc(db, 'avancesFrags', avance.id), {
                statut: 'rembourse',
                dateRemboursement: new Date(today),
                ecritureVersementId: ecritureId,
                updatedAt: serverTimestamp(),
            });
            setAvances((prev) => prev.map((a) => a.id === avance.id ? { ...a, statut: 'rembourse', ecritureVersementId: ecritureId } : a));
        } catch (e) {
            alert('Erreur : ' + e.message);
        } finally {
            setSaving('');
        }
    }

    /** Versement d'un dividende : Débit 457 / Crédit 512 */
    async function verserDividende(div) {
        if (!window.confirm(`Enregistrer le versement du dividende de ${formatMontant(div.montant)} à ${associe.nom} ?`)) return;
        setSaving(div.id);
        try {
            const today = new Date().toISOString().split('T')[0];
            const { ecritureId } = await ecrireEcriture({
                journal: 'BQ',
                date: today,
                libelle: `Versement dividende — ${associe.nom}`,
                sourceType: 'dividende',
                sourceId: div.id,
                mouvements: [
                    { compte: '457', libelle: `Dividendes à payer — ${associe.nom}`, debit: div.montant, credit: 0 },
                    { compte: '512', libelle: 'Banque', debit: 0, credit: div.montant },
                ],
            });
            await updateDoc(doc(db, 'dividendes', div.id), {
                statut: 'verse',
                dateVersement: new Date(today),
                ecritureVersementId: ecritureId,
                updatedAt: serverTimestamp(),
            });
            setDividendes((prev) => prev.map((d) => d.id === div.id ? { ...d, statut: 'verse', ecritureVersementId: ecritureId } : d));
        } catch (e) {
            alert('Erreur : ' + e.message);
        } finally {
            setSaving('');
        }
    }

    if (loading) return <p style={{ color: 'var(--text-muted)' }}>Chargement...</p>;

    return (
        <div>
            {/* Header */}
            <div className="page-header">
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <button className="btn btn--ghost btn--sm" onClick={() => navigate('/associes')}>← Retour</button>
                    <div>
                        <h1 style={{ margin: 0 }}>{associe.nom} {associe.prenom}</h1>
                        <p style={{ margin: 0 }}>
                            {ROLES[associe.role]} · {associe.pourcentageParts} % des parts · Compte <code>{associe.compteCC || '455'}</code>
                            {associe.tauxInteretCCA != null && ` · Taux conventionnel : ${associe.tauxInteretCCA} %`}
                        </p>
                    </div>
                </div>
                <div className="page-header__actions">
                    <button className="btn btn--ghost" onClick={() => navigate('/associes/cca')}>
                        Gérer les CCA
                    </button>
                    <button className="btn btn--ghost" onClick={() => navigate(`/avances/nouvelle?associeId=${associeId}`)}>
                        + Avance frais
                    </button>
                    <button className="btn btn--primary" onClick={() => navigate(`/dividendes/nouveau?associeId=${associeId}`)}>
                        + Dividende
                    </button>
                </div>
            </div>

            {/* Métriques globales CCA */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
                <MetricCard
                    label="Solde total dû par la société"
                    value={formatMontant(soldeTotalCCA)}
                    accent={soldeTotalCCA > 0 ? 'var(--accent)' : 'var(--text-muted)'}
                    hint="Compte 455 (Apports + Frais + Intérêts - Remb.)"
                />
                <MetricCard
                    label="Apports de trésorerie"
                    value={formatMontant(totalApportsCCA)}
                    accent="var(--success)"
                    hint="Fonds propres injectés en CCA"
                />
                <MetricCard
                    label="Avances de frais en attente"
                    value={formatMontant(soldeAvances)}
                    accent={soldeAvances > 0 ? 'var(--warning)' : 'var(--text-muted)'}
                    hint="Notes de frais à rembourser"
                />
                <MetricCard
                    label="Intérêts cumulés"
                    value={formatMontant(totalInteretsCCA)}
                    accent="var(--info)"
                    hint={`Taux conventionnel : ${associe.tauxInteretCCA ?? 'Non défini'} %`}
                />
            </div>

            {/* Mouvements CCA & Justificatifs */}
            <div className="card">
                <div className="card__title" style={{ justifyContent: 'space-between' }}>
                    <span>Mouvements CCA & Pièces justificatives</span>
                    <div style={{ display: 'flex', gap: 6 }}>
                        <button
                            className="btn btn--sm btn--primary"
                            onClick={() => navigate('/associes/cca')}
                        >
                            + Mouvement / Justificatif
                        </button>
                    </div>
                </div>

                {ccaMouvements.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                        Aucun apport direct ni intérêts enregistrés pour cet associé.{' '}
                        <button
                            style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline' }}
                            onClick={() => navigate('/associes/cca')}
                        >
                            Ajouter un apport de trésorerie en CCA
                        </button>
                    </p>
                ) : (
                    <div className="table-wrap">
                        <table>
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Type</th>
                                    <th>Description</th>
                                    <th>Justificatifs</th>
                                    <th style={{ textAlign: 'right' }}>Montant</th>
                                    <th>Écriture</th>
                                </tr>
                            </thead>
                            <tbody>
                                {ccaMouvements.map((m) => {
                                    const docsLies = documents.filter((d) => (m.documentIds ?? []).includes(d.id) || d.sourceId === m.id);
                                    const d = m.dateMouvement?.toDate ? m.dateMouvement.toDate() : new Date(m.dateMouvement);
                                    const isCredit = m.type === 'apport' || m.type === 'interets';
                                    return (
                                        <tr key={m.id}>
                                            <td style={{ fontSize: 12 }}>{formatDate(d)}</td>
                                            <td>
                                                {m.type === 'apport' && <span className="badge badge--success">Apport</span>}
                                                {m.type === 'remboursement' && <span className="badge badge--info">Remboursement</span>}
                                                {m.type === 'interets' && <span className="badge badge--warning">Intérêts ({m.taux}%)</span>}
                                            </td>
                                            <td>{m.description}</td>
                                            <td>
                                                {docsLies.length > 0 ? (
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                                        {docsLies.map((docItem) => (
                                                            <a
                                                                key={docItem.id}
                                                                href={docItem.downloadURL}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="badge badge--muted"
                                                                style={{ textDecoration: 'none' }}
                                                            >
                                                                📎 {docItem.nom}
                                                            </a>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <span style={{ color: 'var(--text-light)', fontSize: 11 }}>—</span>
                                                )}
                                            </td>
                                            <td style={{ textAlign: 'right', fontWeight: 600, color: isCredit ? 'var(--success)' : 'var(--info)' }}>
                                                {isCredit ? `+ ${formatMontant(m.montant)}` : `- ${formatMontant(m.montant)}`}
                                            </td>
                                            <td>
                                                {m.ecritureId ? <code>{m.ecritureId.slice(0, 6)}...</code> : '—'}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Avances de frais */}
            <div className="card">
                <div className="card__title" style={{ justifyContent: 'space-between' }}>
                    <span>Avances de frais (Notes de frais)</span>
                    <button className="btn btn--sm btn--ghost" onClick={() => navigate(`/avances/nouvelle?associeId=${associeId}`)}>
                        + Nouvelle avance
                    </button>
                </div>
                {avances.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Aucune avance de frais enregistrée.</p>
                ) : (
                    <div className="table-wrap">
                        <table>
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Description</th>
                                    <th>Compte</th>
                                    <th style={{ textAlign: 'right' }}>Montant</th>
                                    <th>Statut</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {avances.map((a) => (
                                    <tr key={a.id} style={{ opacity: a.statut === 'annule' ? 0.4 : 1 }}>
                                        <td style={{ fontSize: 12 }}>{formatDate(a.dateAvance)}</td>
                                        <td>{a.description}</td>
                                        <td><code>{a.compteCharge}</code></td>
                                        <td style={{ textAlign: 'right', fontWeight: 500 }}>{formatMontant(a.montant)}</td>
                                        <td>
                                            {a.statut === 'rembourse' && <span className="badge badge--success">Remboursé</span>}
                                            {a.statut === 'a_rembourser' && <span className="badge badge--warning">À rembourser</span>}
                                            {a.statut === 'annule' && <span className="badge badge--muted">Annulé</span>}
                                        </td>
                                        <td>
                                            {a.statut === 'a_rembourser' && (
                                                <button className="btn btn--sm btn--primary" disabled={saving === a.id} onClick={() => rembourserAvance(a)}>
                                                    {saving === a.id ? '...' : 'Rembourser'}
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Dividendes */}
            <div className="card">
                <div className="card__title" style={{ justifyContent: 'space-between' }}>
                    <span>Dividendes</span>
                    <button className="btn btn--sm btn--ghost" onClick={() => navigate(`/dividendes/nouveau?associeId=${associeId}`)}>
                        + Nouveau dividende
                    </button>
                </div>
                {dividendes.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Aucun dividende enregistré.</p>
                ) : (
                    <div className="table-wrap">
                        <table>
                            <thead>
                                <tr>
                                    <th>Décision AG</th>
                                    <th>Compte débité</th>
                                    <th style={{ textAlign: 'right' }}>Montant</th>
                                    <th>Versement</th>
                                    <th>Statut</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {dividendes.map((d) => (
                                    <tr key={d.id}>
                                        <td style={{ fontSize: 12 }}>{formatDate(d.dateDecisionAG)}</td>
                                        <td><code>{d.compteDebit}</code></td>
                                        <td style={{ textAlign: 'right', fontWeight: 500 }}>{formatMontant(d.montant)}</td>
                                        <td style={{ fontSize: 12 }}>{d.dateVersement ? formatDate(d.dateVersement) : '—'}</td>
                                        <td>
                                            {d.statut === 'verse' && <span className="badge badge--success">Versé</span>}
                                            {d.statut === 'a_verser' && <span className="badge badge--warning">À verser</span>}
                                            {d.statut === 'annule' && <span className="badge badge--muted">Annulé</span>}
                                        </td>
                                        <td>
                                            {d.statut === 'a_verser' && (
                                                <button className="btn btn--sm btn--primary" disabled={saving === d.id} onClick={() => verserDividende(d)}>
                                                    {saving === d.id ? '...' : 'Verser'}
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}

function MetricCard({ label, value, accent = 'var(--text)', hint }) {
    return (
        <div className="card" style={{ padding: '16px 20px', marginBottom: 0 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>{label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: accent }}>{value}</div>
            {hint && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{hint}</div>}
        </div>
    );
}
