/**
 * FacturationClient.jsx
 * Remplace VersementStripe — Facture multi-lignes avec récurrences mixtes.
 *
 * Chaque ligne a : description, qté, prix unitaire, récurrence (unique / mensuel / trimestriel / annuel)
 * Le formulaire calcule :
 *   - Total one-shot
 *   - MRR équivalent (ramené au mois)
 *   - Projections 1 / 2 / 3 ans
 *
 * Saisie optionnelle du virement Stripe (brut / frais / net).
 * Écritures via garde-fou :
 *   Facturation : Débit 411 / Crédit 706
 *   Si Stripe encaissé : Débit 512, Débit 6278, Crédit 411
 */
import { useState, useEffect, useCallback } from 'react';
import {
    collection, getDocs, addDoc, doc, query, orderBy, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { ecrireEcriture } from '../services/api';
import { formatMontant } from '../services/helpers';

const RECURRENCES = [
    { value: 'unique', label: 'Ponctuel (une fois)', coefMRR: 0 },
    { value: 'mensuel', label: 'Mensuel', coefMRR: 1 },
    { value: 'trimestriel', label: 'Trimestriel', coefMRR: 1 / 3 },
    { value: 'annuel', label: 'Annuel', coefMRR: 1 / 12 },
];

const LIGNE_VIDE = () => ({
    id: Date.now() + Math.random(),
    description: '',
    quantite: 1,
    prixUnitaire: '',
    recurrence: 'mensuel',
});

function computeTotaux(lignes) {
    let totalOneShot = 0;
    let mrr = 0;
    for (const l of lignes) {
        const pu = parseFloat(l.prixUnitaire) || 0;
        const total = pu * (parseFloat(l.quantite) || 1);
        const rec = RECURRENCES.find((r) => r.value === l.recurrence);
        if (l.recurrence === 'unique') {
            totalOneShot += total;
        } else {
            mrr += total * (rec?.coefMRR ?? 0);
        }
    }
    return { totalOneShot, mrr };
}

export function FacturationClient() {
    const [clients, setClients] = useState([]);
    const [clientId, setClientId] = useState('');
    const [clientQ, setClientQ] = useState('');
    const [showList, setShowList] = useState(false);
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [lignes, setLignes] = useState([LIGNE_VIDE()]);
    const [notes, setNotes] = useState('');
    const [withStripe, setWithStripe] = useState(false);
    const [stripe, setStripe] = useState({ brut: '', frais: '', net: '' });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [done, setDone] = useState(null);

    useEffect(() => {
        getDocs(query(collection(db, 'clients'), orderBy('nom')))
            .then((s) => setClients(s.docs.map((d) => ({ id: d.id, ...d.data() }))));
    }, []);

    // Autocomplétion client
    const clientsFiltres = clientQ.length > 0
        ? clients.filter((c) => `${c.nom} ${c.prenom}`.toLowerCase().includes(clientQ.toLowerCase())).slice(0, 6)
        : [];
    const clientSelectionne = clients.find((c) => c.id === clientId);

    function selectClient(c) {
        setClientId(c.id);
        setClientQ(`${c.nom} ${c.prenom}`);
        setShowList(false);
    }

    // Gestion des lignes
    function updateLigne(id, field, value) {
        setLignes((prev) => prev.map((l) => l.id === id ? { ...l, [field]: value } : l));
    }
    function addLigne() { setLignes((prev) => [...prev, LIGNE_VIDE()]); }
    function removeLigne(id) { setLignes((prev) => prev.filter((l) => l.id !== id)); }

    // Calculs en live
    const { totalOneShot, mrr } = computeTotaux(lignes);
    const totalFacture = totalOneShot + lignes
        .filter((l) => l.recurrence !== 'unique')
        .reduce((s, l) => s + (parseFloat(l.prixUnitaire) || 0) * (parseFloat(l.quantite) || 1), 0);

    const stripeNet = parseFloat(stripe.net) || parseFloat(stripe.brut) - parseFloat(stripe.frais) || 0;
    const strapeBrut = parseFloat(stripe.brut) || 0;
    const stripeFrags = parseFloat(stripe.frais) || 0;

    // Stripe net auto-calc
    useEffect(() => {
        const b = parseFloat(stripe.brut) || 0;
        const f = parseFloat(stripe.frais) || 0;
        if (b && f) setStripe((s) => ({ ...s, net: (b - f).toFixed(2) }));
    }, [stripe.brut, stripe.frais]);

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        const lignesValides = lignes.filter((l) => l.description.trim() && parseFloat(l.prixUnitaire) > 0);
        if (!lignesValides.length) { setError('Ajoutez au moins une ligne avec description et prix.'); return; }
        if (totalFacture <= 0) { setError('Le total de la facture doit être positif.'); return; }
        if (withStripe && !strapeBrut) { setError('Saisissez le montant brut Stripe.'); return; }
        setSaving(true);

        try {
            // Écriture 1 : facturation (411 / 706)
            const libelle = clientSelectionne
                ? `Facturation — ${clientSelectionne.nom} ${clientSelectionne.prenom ?? ''}`.trim()
                : 'Facturation client';

            const { ecritureId: ecritureFactId } = await ecrireEcriture({
                journal: 'VT',
                date,
                libelle,
                sourceType: 'facturation',
                mouvements: [
                    { compte: '411', libelle: 'Clients', debit: totalFacture, credit: 0 },
                    { compte: '706', libelle: 'Prestations de services', debit: 0, credit: totalFacture },
                ],
            });

            let ecritureStripeId = null;
            // Écriture 2 : encaissement Stripe (512 + 6278 / 411)
            if (withStripe && strapeBrut) {
                const res = await ecrireEcriture({
                    journal: 'BQ',
                    date,
                    libelle: `Encaissement Stripe — ${libelle}`,
                    sourceType: 'facturation',
                    mouvements: [
                        { compte: '512', libelle: 'Banque', debit: stripeNet, credit: 0 },
                        { compte: '6278', libelle: 'Frais Stripe', debit: stripeFrags, credit: 0 },
                        { compte: '411', libelle: 'Clients', debit: 0, credit: strapeBrut },
                    ],
                });
                ecritureStripeId = res.ecritureId;
            }

            // Sauvegarde Firestore
            await addDoc(collection(db, 'facturations'), {
                clientId: clientId || null,
                clientNom: clientSelectionne ? `${clientSelectionne.nom} ${clientSelectionne.prenom ?? ''}`.trim() : null,
                date: new Date(date),
                lignes: lignesValides.map((l) => ({
                    description: l.description.trim(),
                    quantite: parseFloat(l.quantite) || 1,
                    prixUnitaire: parseFloat(l.prixUnitaire),
                    recurrence: l.recurrence,
                    total: (parseFloat(l.prixUnitaire) || 0) * (parseFloat(l.quantite) || 1),
                })),
                notes: notes.trim() || null,
                totalOneShot,
                mrr,
                totalFacture,
                withStripe,
                stripe: withStripe ? { brut: strapeBrut, frais: stripeFrags, net: stripeNet } : null,
                ecritureFactId,
                ecritureStripeId,
                createdAt: serverTimestamp(),
            });

            setDone({ clientNom: clientSelectionne?.nom ?? 'Client', totalFacture, mrr, withStripe });
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    if (done) return (
        <div>
            <div className="notice notice--success">
                Facturation de {formatMontant(done.totalFacture)} enregistrée pour {done.clientNom}.
                {done.mrr > 0 && ` MRR généré : ${formatMontant(done.mrr)} / mois.`}
                {done.withStripe && ' Encaissement Stripe comptabilisé.'}
            </div>
            <button className="btn btn--primary" onClick={() => { setDone(null); setLignes([LIGNE_VIDE()]); setStripe({ brut: '', frais: '', net: '' }); setClientId(''); setClientQ(''); }}>
                Nouvelle facturation
            </button>
        </div>
    );

    return (
        <form onSubmit={handleSubmit}>
            <div className="page-header">
                <div>
                    <h1>Facturation client</h1>
                    <p>Facture multi-lignes avec récurrences mixtes — génère les écritures comptables</p>
                </div>
            </div>

            {error && <div className="notice notice--danger">{error}</div>}

            {/* Client + Date */}
            <div className="card">
                <div className="card__title">Informations</div>
                <div className="form-row">
                    <div className="form-group" style={{ position: 'relative' }}>
                        <label className="form-label">Client (optionnel)</label>
                        <input
                            type="text" className="form-input"
                            value={clientQ}
                            onChange={(e) => { setClientQ(e.target.value); setClientId(''); setShowList(true); }}
                            onBlur={() => setTimeout(() => setShowList(false), 150)}
                            placeholder="Rechercher un client..."
                        />
                        {showList && clientsFiltres.length > 0 && (
                            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-md)', marginTop: 2 }}>
                                {clientsFiltres.map((c) => (
                                    <div key={c.id} onMouseDown={() => selectClient(c)}
                                        style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid var(--border)' }}
                                        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg2)'}
                                        onMouseLeave={(e) => e.currentTarget.style.background = ''}
                                    >
                                        {c.nom} {c.prenom}
                                        {c.categorieNom && <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>{c.categorieNom}</span>}
                                    </div>
                                ))}
                            </div>
                        )}
                        {!clientId && clientQ && <p className="form-hint">Client non sélectionné — la facture sera sans rattachement.</p>}
                    </div>
                    <div className="form-group">
                        <label className="form-label">Date de facturation</label>
                        <input type="date" className="form-input" value={date} onChange={(e) => setDate(e.target.value)} required />
                    </div>
                </div>
            </div>

            {/* Lignes de facturation */}
            <div className="card">
                <div className="card__title" style={{ justifyContent: 'space-between' }}>
                    <span>Lignes de la facture</span>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={addLigne}>+ Ajouter une ligne</button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {/* En-têtes */}
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 80px 120px 160px 40px', gap: 8, fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', paddingBottom: 4, borderBottom: '1px solid var(--border)' }}>
                        <span>Description</span><span style={{ textAlign: 'center' }}>Qté</span><span>Prix unitaire</span><span>Récurrence</span><span></span>
                    </div>

                    {lignes.map((l, idx) => (
                        <div key={l.id} style={{ display: 'grid', gridTemplateColumns: '2fr 80px 120px 160px 40px', gap: 8, alignItems: 'center' }}>
                            <input
                                type="text" className="form-input"
                                value={l.description}
                                onChange={(e) => updateLigne(l.id, 'description', e.target.value)}
                                placeholder={`Produit / Prestation ${idx + 1}`}
                            />
                            <input
                                type="number" min="1" step="1" className="form-input"
                                value={l.quantite}
                                onChange={(e) => updateLigne(l.id, 'quantite', e.target.value)}
                                style={{ textAlign: 'center' }}
                            />
                            <div style={{ position: 'relative' }}>
                                <input
                                    type="number" min="0.01" step="0.01" className="form-input"
                                    value={l.prixUnitaire}
                                    onChange={(e) => updateLigne(l.id, 'prixUnitaire', e.target.value)}
                                    placeholder="0.00"
                                    style={{ paddingRight: 24 }}
                                />
                                <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: 12, pointerEvents: 'none' }}>€</span>
                            </div>
                            <select className="form-select" value={l.recurrence} onChange={(e) => updateLigne(l.id, 'recurrence', e.target.value)}>
                                {RECURRENCES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                            </select>
                            <button type="button" className="btn btn--sm btn--danger btn--icon"
                                onClick={() => removeLigne(l.id)}
                                disabled={lignes.length === 1}
                                style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                title="Supprimer cette ligne"
                            >×</button>
                        </div>
                    ))}
                </div>

                {/* Notes */}
                <div className="form-group" style={{ marginTop: 16 }}>
                    <label className="form-label">Notes internes (optionnel)</label>
                    <textarea className="form-textarea" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Détails, numéro de devis, conditions particulières..." />
                </div>
            </div>

            {/* Résumé & projections */}
            {(totalOneShot > 0 || mrr > 0) && (
                <div className="card" style={{ borderColor: 'var(--border-focus)' }}>
                    <div className="card__title">Résumé & projections</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
                        {totalOneShot > 0 && <SummaryBox label="Ponctuel" value={formatMontant(totalOneShot)} />}
                        {mrr > 0 && <SummaryBox label="MRR généré" value={formatMontant(mrr) + ' / mois'} accent="var(--success)" />}
                        {mrr > 0 && <SummaryBox label="Projection 1 an" value={formatMontant(mrr * 12 + totalOneShot)} />}
                        {mrr > 0 && <SummaryBox label="Projection 2 ans" value={formatMontant(mrr * 24 + totalOneShot)} />}
                        {mrr > 0 && <SummaryBox label="Projection 3 ans" value={formatMontant(mrr * 36 + totalOneShot)} />}
                    </div>
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Total facture (1ère période)</span>
                        <span style={{ fontSize: 18, fontWeight: 700 }}>{formatMontant(totalFacture)}</span>
                    </div>
                </div>
            )}

            {/* Encaissement Stripe */}
            <div className="card">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: withStripe ? 16 : 0 }}>
                    <input type="checkbox" id="with-stripe" checked={withStripe} onChange={(e) => setWithStripe(e.target.checked)} style={{ width: 16, height: 16 }} />
                    <label htmlFor="with-stripe" style={{ fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
                        Enregistrer l'encaissement Stripe en même temps (virement déjà reçu)
                    </label>
                </div>
                {withStripe && (
                    <div className="form-row form-row--3">
                        <div className="form-group">
                            <label className="form-label">Montant brut Stripe (€)</label>
                            <input type="number" min="0.01" step="0.01" className="form-input" value={stripe.brut}
                                onChange={(e) => setStripe((s) => ({ ...s, brut: e.target.value }))} placeholder="Ex. 100.00" />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Frais Stripe (€)</label>
                            <input type="number" min="0" step="0.01" className="form-input" value={stripe.frais}
                                onChange={(e) => setStripe((s) => ({ ...s, frais: e.target.value }))} placeholder="Ex. 2.25" />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Net reçu (€)</label>
                            <input type="number" min="0.01" step="0.01" className="form-input" value={stripe.net}
                                onChange={(e) => setStripe((s) => ({ ...s, net: e.target.value }))} placeholder="Auto-calculé" />
                        </div>
                    </div>
                )}
            </div>

            {/* Aperçu écritures */}
            {totalFacture > 0 && (
                <div className="card" style={{ borderColor: '#2563eb' }}>
                    <div className="card__title">Ecritures générées</div>
                    <div className="table-wrap">
                        <table>
                            <thead><tr><th>Journal</th><th>Compte</th><th>Libellé</th><th style={{ textAlign: 'right' }}>Débit</th><th style={{ textAlign: 'right' }}>Crédit</th></tr></thead>
                            <tbody>
                                <tr><td rowSpan={2} style={{ fontWeight: 600, fontSize: 11 }}>VT</td><td><code>411</code></td><td>Clients</td><td style={{ textAlign: 'right' }}>{formatMontant(totalFacture)}</td><td style={{ textAlign: 'right' }}>—</td></tr>
                                <tr><td><code>706</code></td><td>Prestations</td><td style={{ textAlign: 'right' }}>—</td><td style={{ textAlign: 'right' }}>{formatMontant(totalFacture)}</td></tr>
                                {withStripe && strapeBrut > 0 && <>
                                    <tr style={{ borderTop: '2px dashed var(--border)' }}>
                                        <td rowSpan={3} style={{ fontWeight: 600, fontSize: 11 }}>BQ</td>
                                        <td><code>512</code></td><td>Banque</td><td style={{ textAlign: 'right' }}>{formatMontant(stripeNet)}</td><td style={{ textAlign: 'right' }}>—</td>
                                    </tr>
                                    <tr><td><code>6278</code></td><td>Frais Stripe</td><td style={{ textAlign: 'right' }}>{formatMontant(stripeFrags)}</td><td style={{ textAlign: 'right' }}>—</td></tr>
                                    <tr><td><code>411</code></td><td>Clients</td><td style={{ textAlign: 'right' }}>—</td><td style={{ textAlign: 'right' }}>{formatMontant(strapeBrut)}</td></tr>
                                </>}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            <button type="submit" className="btn btn--primary" disabled={saving} style={{ minWidth: 200 }}>
                {saving ? 'Enregistrement...' : 'Enregistrer la facturation'}
            </button>
        </form>
    );
}

function SummaryBox({ label, value, accent = 'var(--text)' }) {
    return (
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '10px 14px' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: accent }}>{value}</div>
        </div>
    );
}
