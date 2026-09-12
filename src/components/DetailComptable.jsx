/**
 * Section "Voir le détail comptable"  dépliable sur chaque facture/dépense.
 * Montre les écritures générées avec compte, débit, crédit, et possibilité
 * de déclencher une contre-passation.
 */
import { useState, useEffect } from 'react';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { contrepasser } from '../services/api';
import { formatMontant, formatDate } from '../services/helpers';
import { Tooltip } from './Shared';

const TOOLTIP_DEBIT = "Le débit enregistre ce qui entre dans un compte (ex. : votre client vous doit de l'argent  son compte est débité). Dans la partie double, chaque débit est compensé par un crédit de même montant.";
const TOOLTIP_CREDIT = "Le crédit enregistre ce qui sort d'un compte ou ce que vous devez (ex. : vous avez réalisé une prestation  votre compte de produits est crédité). Chaque crédit est compensé par un débit.";
const TOOLTIP_COMPTE = "Le numéro de compte identifie la nature de l'écriture selon le Plan Comptable Général français. Ex. 411 = créances clients, 706 = prestations de services, 512 = banque.";
const TOOLTIP_CORRIGER = "En comptabilité, une écriture validée ne doit jamais être supprimée ou modifiée directement  cela permettrait de falsifier les comptes. Pour corriger une erreur, on crée une écriture \"miroir\" qui l'annule, puis on ressaisit la version correcte. Toutes les écritures restent visibles dans l'historique.";

/**
 * @param {Object} props
 * @param {string[]} props.ecritureIds - IDs des écritures liées
 * @param {string}   props.sourceType  - "facture" | "depense"
 */
export function DetailComptable({ ecritureIds, sourceType }) {
    const [ecritures, setEcritures] = useState([]);
    const [loading, setLoading] = useState(false);
    const [open, setOpen] = useState(false);
    const [corriger, setCorriger] = useState(null);   // id écriture à corriger
    const [motif, setMotif] = useState('');
    const [correcting, setCorrecting] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    useEffect(() => {
        if (!open || !ecritureIds?.length) return;
        setLoading(true);
        Promise.all(
            ecritureIds.map((id) => getDoc(doc(db, 'ecritures', id)))
        ).then((snaps) => {
            setEcritures(snaps.filter((s) => s.exists()).map((s) => ({ id: s.id, ...s.data() })));
            setLoading(false);
        });
    }, [open, ecritureIds]);

    async function handleContrepasser(ecritureId) {
        if (!motif.trim()) { setError('Le motif de correction est obligatoire.'); return; }
        setCorrecting(true); setError(''); setSuccess('');
        try {
            const { annulationId } = await contrepasser(ecritureId, motif);
            setSuccess(`Contre-passation créée (id: ${annulationId}). Vous pouvez maintenant ressaisir l'écriture correcte.`);
            setCorriger(null); setMotif('');
            // Recharger
            setOpen(false); setTimeout(() => setOpen(true), 300);
        } catch (e) {
            setError(e.message);
        } finally {
            setCorrecting(false);
        }
    }

    if (!ecritureIds?.length) return null;

    return (
        <details className="accordion" open={open} onToggle={(e) => setOpen(e.target.open)}>
            <summary>
                 Voir le détail comptable ({ecritureIds.length} écriture{ecritureIds.length > 1 ? 's' : ''})
            </summary>
            <div className="accordion__body">
                {loading && <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Chargement</p>}
                {success && <div className="notice notice--success">{success}</div>}
                {error && <div className="notice notice--danger">{error}</div>}

                {ecritures.map((ec) => (
                    <div key={ec.id} style={{ marginBottom: 20 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <div>
                                <span className={`badge ${ec.statut === 'annulee' ? 'badge--danger' : 'badge--muted'}`}>
                                    Journal {ec.journal}
                                </span>
                                {' '}
                                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                                    {formatDate(ec.date)}  {ec.libelle}
                                </span>
                                {ec.statut === 'annulee' && (
                                    <span className="ecriture-annulee-label"> · Annulée par contre-passation le {formatDate(ec.annuleeLeDate)}</span>
                                )}
                            </div>
                            {ec.statut === 'active' && (
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                    <Tooltip text={TOOLTIP_CORRIGER} />
                                    <button
                                        className="btn btn--sm btn--danger"
                                        onClick={() => setCorriger(corriger === ec.id ? null : ec.id)}
                                    >
                                        Corriger
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Table mouvements */}
                        <div className="table-wrap accordion ecritures-table" style={{ border: 'none' }}>
                            <table>
                                <thead>
                                    <tr>
                                        <th>
                                            Compte <Tooltip text={TOOLTIP_COMPTE} />
                                        </th>
                                        <th>Libellé</th>
                                        <th style={{ textAlign: 'right' }}>
                                            Débit <Tooltip text={TOOLTIP_DEBIT} />
                                        </th>
                                        <th style={{ textAlign: 'right' }}>
                                            Crédit <Tooltip text={TOOLTIP_CREDIT} />
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className={ec.statut === 'annulee' ? 'ecriture-annulee' : ''}>
                                    {(ec.mouvements ?? []).map((m, i) => (
                                        <tr key={i}>
                                            <td><code style={{ fontSize: 13 }}>{m.compte}</code></td>
                                            <td>{m.libelle}</td>
                                            <td style={{ textAlign: 'right' }}>{m.debit ? formatMontant(m.debit) : ''}</td>
                                            <td style={{ textAlign: 'right' }}>{m.credit ? formatMontant(m.credit) : ''}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Formulaire de contre-passation */}
                        {corriger === ec.id && (
                            <div style={{ marginTop: 12, padding: 14, background: 'var(--bg3)', borderRadius: 'var(--radius)' }}>
                                <p style={{ fontSize: 13, marginBottom: 8 }}>
                                    <strong>Motif de la correction</strong> (obligatoire)
                                </p>
                                <input
                                    type="text"
                                    className="form-input"
                                    placeholder="Ex. : Erreur de montant  facture 2026-001"
                                    value={motif}
                                    onChange={(e) => setMotif(e.target.value)}
                                    style={{ marginBottom: 10 }}
                                />
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <button
                                        className="btn btn--danger btn--sm"
                                        disabled={correcting}
                                        onClick={() => handleContrepasser(ec.id)}
                                    >
                                        {correcting ? 'En cours' : 'Confirmer la contre-passation'}
                                    </button>
                                    <button className="btn btn--ghost btn--sm" onClick={() => { setCorriger(null); setMotif(''); }}>
                                        Annuler
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </details>
    );
}
