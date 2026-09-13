/**
 * FacturationClient.jsx
 * Facture multi-lignes avec récurrences mixtes, date de démarrage par abonnement/item,
 * date d'encaissement quand le client a payé, et gestion des pièces justificatives.
 * 
 * Contrainte stricte : AUCUN EMOJI. Design clair, sobre et efficace.
 */
import { useState, useEffect } from 'react';
import {
    collection, getDocs, addDoc, doc, query, orderBy, serverTimestamp, updateDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import { ecrireEcriture } from '../services/api';
import { formatMontant } from '../services/helpers';
import { FileUpload } from './FileUpload';

const RECURRENCES = [
    { value: 'unique', label: 'Ponctuel (une fois)', coefMRR: 0 },
    { value: 'mensuel', label: 'Mensuel', coefMRR: 1 },
    { value: 'trimestriel', label: 'Trimestriel', coefMRR: 1 / 3 },
    { value: 'annuel', label: 'Annuel', coefMRR: 1 / 12 },
];

const MODES_PAIEMENT = [
    { value: 'virement', label: 'Virement bancaire' },
    { value: 'stripe', label: 'Stripe / Prélèvement en ligne' },
    { value: 'cb', label: 'Carte bancaire' },
    { value: 'cheque', label: 'Chèque' },
    { value: 'autre', label: 'Autre mode' },
];

const LIGNE_VIDE = (defaultDate = '') => ({
    id: Date.now() + Math.random(),
    description: '',
    dateDebut: defaultDate || new Date().toISOString().split('T')[0],
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
    const todayStr = new Date().toISOString().split('T')[0];

    const [clients, setClients] = useState([]);
    const [clientId, setClientId] = useState('');
    const [clientQ, setClientQ] = useState('');
    const [showList, setShowList] = useState(false);
    const [date, setDate] = useState(todayStr);

    // Lignes de facturation
    const [lignes, setLignes] = useState([LIGNE_VIDE(todayStr)]);
    const [notes, setNotes] = useState('');

    // Encaissement / Paiement
    const [withPayment, setWithPayment] = useState(false);
    const [datePaiement, setDatePaiement] = useState(todayStr);
    const [modePaiement, setModePaiement] = useState('virement');
    const [montantRecuManuel, setMontantRecuManuel] = useState('');
    const [stripe, setStripe] = useState({ brut: '', frais: '', net: '' });

    // Pièces justificatives
    const [documentIds, setDocumentIds] = useState([]);

    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [done, setDone] = useState(null);

    useEffect(() => {
        getDocs(query(collection(db, 'clients'), orderBy('nom')))
            .then((s) => setClients(s.docs.map((d) => ({ id: d.id, ...d.data() }))));
    }, []);

    // Autocomplétion client
    const clientsFiltres = clientQ.length > 0
        ? clients.filter((c) => `${c.nom} ${c.prenom ?? ''}`.toLowerCase().includes(clientQ.toLowerCase())).slice(0, 6)
        : [];
    const clientSelectionne = clients.find((c) => c.id === clientId);

    function selectClient(c) {
        setClientId(c.id);
        setClientQ(`${c.nom} ${c.prenom ?? ''}`.trim());
        setShowList(false);
    }

    // Gestion des lignes
    function updateLigne(id, field, value) {
        setLignes((prev) => prev.map((l) => l.id === id ? { ...l, [field]: value } : l));
    }
    function addLigne() { setLignes((prev) => [...prev, LIGNE_VIDE(date)]); }
    function removeLigne(id) { setLignes((prev) => prev.filter((l) => l.id !== id)); }

    // Calculs en live
    const { totalOneShot, mrr } = computeTotaux(lignes);
    const totalFacture = totalOneShot + lignes
        .filter((l) => l.recurrence !== 'unique')
        .reduce((s, l) => s + (parseFloat(l.prixUnitaire) || 0) * (parseFloat(l.quantite) || 1), 0);

    const stripeNet = parseFloat(stripe.net) || parseFloat(stripe.brut) - parseFloat(stripe.frais) || 0;
    const strapeBrut = parseFloat(stripe.brut) || 0;
    const stripeFrags = parseFloat(stripe.frais) || 0;

    // Calcul automatique net Stripe
    useEffect(() => {
        const b = parseFloat(stripe.brut) || 0;
        const f = parseFloat(stripe.frais) || 0;
        if (b && f >= 0) setStripe((s) => ({ ...s, net: (b - f).toFixed(2) }));
    }, [stripe.brut, stripe.frais]);

    // Pré-remplir le montant brut si Stripe activé
    useEffect(() => {
        if (withPayment && modePaiement === 'stripe' && totalFacture > 0 && !stripe.brut) {
            setStripe((s) => ({ ...s, brut: String(totalFacture.toFixed(2)) }));
        }
    }, [withPayment, modePaiement, totalFacture, stripe.brut]);

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        const lignesValides = lignes.filter((l) => l.description.trim() && parseFloat(l.prixUnitaire) > 0);
        if (!lignesValides.length) { setError('Ajoutez au moins une ligne avec description et prix.'); return; }
        if (totalFacture <= 0) { setError('Le total de la facture doit être positif.'); return; }

        if (withPayment) {
            if (!datePaiement) { setError('Veuillez renseigner la date à laquelle le client a payé.'); return; }
            if (modePaiement === 'stripe' && !strapeBrut) { setError('Saisissez le montant brut Stripe.'); return; }
        }

        setSaving(true);

        try {
            const libelle = clientSelectionne
                ? `Facturation — ${clientSelectionne.nom} ${clientSelectionne.prenom ?? ''}`.trim()
                : (clientQ.trim() ? `Facturation — ${clientQ.trim()}` : 'Facturation client');

            // 1. Écriture de VENTE (Journal VT, à la date de facturation)
            const { ecritureId: ecritureFactId } = await ecrireEcriture({
                journal: 'VT',
                date,
                libelle,
                sourceType: 'facturation',
                mouvements: [
                    { compte: '411', libelle: clientSelectionne?.nom || 'Clients', debit: totalFacture, credit: 0 },
                    { compte: '706', libelle: 'Prestations de services', debit: 0, credit: totalFacture },
                ],
            });

            let ecriturePaiementId = null;

            // 2. Écriture d'ENCAISSEMENT (Journal BQ, à la DATE OÙ LE CLIENT A PAYÉ)
            if (withPayment) {
                if (modePaiement === 'stripe' && strapeBrut > 0) {
                    const res = await ecrireEcriture({
                        journal: 'BQ',
                        date: datePaiement || date,
                        libelle: `Encaissement Stripe — ${libelle}`,
                        sourceType: 'facturation',
                        mouvements: [
                            { compte: '512', libelle: 'Banque', debit: stripeNet, credit: 0 },
                            { compte: '6278', libelle: 'Frais Stripe', debit: stripeFrags, credit: 0 },
                            { compte: '411', libelle: 'Clients', debit: 0, credit: strapeBrut },
                        ],
                    });
                    ecriturePaiementId = res.ecritureId;
                } else {
                    const montantEncaisse = parseFloat(montantRecuManuel) || totalFacture;
                    const res = await ecrireEcriture({
                        journal: 'BQ',
                        date: datePaiement || date,
                        libelle: `Règlement reçu (${modePaiement}) — ${libelle}`,
                        sourceType: 'facturation',
                        mouvements: [
                            { compte: '512', libelle: 'Banque', debit: montantEncaisse, credit: 0 },
                            { compte: '411', libelle: 'Clients', debit: 0, credit: montantEncaisse },
                        ],
                    });
                    ecriturePaiementId = res.ecritureId;
                }
            }

            // 3. Sauvegarde de la Facturation dans Firestore
            const facturationData = {
                clientId: clientId || null,
                clientNom: clientSelectionne
                    ? `${clientSelectionne.nom} ${clientSelectionne.prenom ?? ''}`.trim()
                    : (clientQ.trim() || 'Client ponctuel'),
                date: new Date(date),
                dateFacturation: date,
                datePaiement: withPayment && datePaiement ? new Date(datePaiement) : null,
                datePaiementStr: withPayment ? datePaiement : null,
                withPayment: !!withPayment,
                modePaiement: withPayment ? modePaiement : null,
                statut: withPayment ? 'encaissee' : 'en_attente',
                lignes: lignesValides.map((l) => ({
                    description: l.description.trim(),
                    dateDebut: l.dateDebut || date,
                    quantite: parseFloat(l.quantite) || 1,
                    prixUnitaire: parseFloat(l.prixUnitaire),
                    recurrence: l.recurrence,
                    total: (parseFloat(l.prixUnitaire) || 0) * (parseFloat(l.quantite) || 1),
                })),
                notes: notes.trim() || null,
                totalOneShot,
                mrr,
                totalFacture,
                withStripe: withPayment && modePaiement === 'stripe',
                stripe: (withPayment && modePaiement === 'stripe')
                    ? { brut: strapeBrut, frais: stripeFrags, net: stripeNet }
                    : null,
                ecritureFactId,
                ecritureStripeId: ecriturePaiementId,
                ecriturePaiementId,
                documentIds: documentIds || [],
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            };

            const facturationRef = await addDoc(collection(db, 'facturations'), facturationData);

            // 4. Lier les pièces justificatives au document facturation
            for (const dId of documentIds) {
                try {
                    await updateDoc(doc(db, 'documents', dId), { sourceId: facturationRef.id });
                } catch (e) {
                    console.warn('Liaison document justificatif ignoree:', e);
                }
            }

            // 5. Renseigner sourceId sur les écritures comptables
            if (ecritureFactId) {
                try {
                    await updateDoc(doc(db, 'ecritures', ecritureFactId), { sourceId: facturationRef.id });
                } catch (e) {
                    console.warn('Liaison ecriture facture ignoree:', e);
                }
            }
            if (ecriturePaiementId) {
                try {
                    await updateDoc(doc(db, 'ecritures', ecriturePaiementId), { sourceId: facturationRef.id });
                } catch (e) {
                    console.warn('Liaison ecriture paiement ignoree:', e);
                }
            }

            setDone({
                clientNom: facturationData.clientNom,
                totalFacture,
                mrr,
                withPayment,
                datePaiement: withPayment ? datePaiement : null,
                nbDocuments: documentIds.length,
            });
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    if (done) return (
        <div>
            <div className="notice notice--success">
                Facturation de <strong>{formatMontant(done.totalFacture)}</strong> enregistrée pour <strong>{done.clientNom}</strong>.
                {done.mrr > 0 && ` MRR généré : ${formatMontant(done.mrr)} / mois.`}
                {done.withPayment && ` Encaissement comptabilisé au ${done.datePaiement}.`}
                {done.nbDocuments > 0 && ` (${done.nbDocuments} justificatif(s) rattaché(s)).`}
            </div>
            <button
                className="btn btn--primary"
                onClick={() => {
                    setDone(null);
                    setLignes([LIGNE_VIDE(todayStr)]);
                    setStripe({ brut: '', frais: '', net: '' });
                    setClientId('');
                    setClientQ('');
                    setDocumentIds([]);
                    setWithPayment(false);
                }}
            >
                Nouvelle facturation
            </button>
        </div>
    );

    return (
        <form onSubmit={handleSubmit}>
            <div className="page-header">
                <div>
                    <h1 style={{ margin: 0 }}>Facturation client</h1>
                    <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>
                        Facture multi-lignes avec récurrences mixtes, date de démarrage par abonnement et justificatifs.
                    </p>
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
                            onBlur={() => setTimeout(() => setShowList(false), 200)}
                            placeholder="Rechercher ou saisir un nom de client..."
                        />
                        {showList && clientsFiltres.length > 0 && (
                            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-md)', marginTop: 2 }}>
                                {clientsFiltres.map((c) => (
                                    <div key={c.id} onMouseDown={() => selectClient(c)}
                                        style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid var(--border)' }}
                                        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg2)'}
                                        onMouseLeave={(e) => e.currentTarget.style.background = ''}
                                    >
                                        <div style={{ fontWeight: 600 }}>{c.nom}</div>
                                        {(c.contactPrenom || c.email) && (
                                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                                {[c.contactPrenom, c.contactNom, c.email].filter(Boolean).join(' · ')}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                        {!clientId && clientQ && <p className="form-hint">Client libre — la facture sera enregistrée avec ce libellé.</p>}
                    </div>
                    <div className="form-group">
                        <label className="form-label">Date d'émission de la facture</label>
                        <input type="date" className="form-input" value={date} onChange={(e) => setDate(e.target.value)} required />
                    </div>
                </div>
            </div>

            {/* Lignes de facturation */}
            <div className="card">
                <div className="card__title" style={{ justifyContent: 'space-between' }}>
                    <span>Lignes de la facture & Démarrage des abonnements</span>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={addLigne}>+ Ajouter une ligne</button>
                </div>

                <div style={{ overflowX: 'auto' }}>
                    <div style={{ minWidth: 700, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {/* En-têtes */}
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: '2fr 135px 65px 110px 145px 36px',
                            gap: 8,
                            fontSize: 11,
                            color: 'var(--text-muted)',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px',
                            paddingBottom: 6,
                            borderBottom: '1px solid var(--border)',
                        }}>
                            <span>Description</span>
                            <span>Date de début</span>
                            <span style={{ textAlign: 'center' }}>Qté</span>
                            <span>Prix unitaire</span>
                            <span>Récurrence</span>
                            <span></span>
                        </div>

                        {lignes.map((l, idx) => (
                            <div key={l.id} style={{ display: 'grid', gridTemplateColumns: '2fr 135px 65px 110px 145px 36px', gap: 8, alignItems: 'center' }}>
                                <input
                                    type="text" className="form-input"
                                    value={l.description}
                                    onChange={(e) => updateLigne(l.id, 'description', e.target.value)}
                                    placeholder={`Prestation / Abonnement ${idx + 1}`}
                                />
                                <input
                                    type="date" className="form-input"
                                    value={l.dateDebut || date}
                                    onChange={(e) => updateLigne(l.id, 'dateDebut', e.target.value)}
                                    title="Date à laquelle l'abonnement ou la prestation commence"
                                    style={{ fontSize: 12 }}
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
                                        style={{ paddingRight: 22 }}
                                    />
                                    <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: 12, pointerEvents: 'none' }}>€</span>
                                </div>
                                <select className="form-select" value={l.recurrence} onChange={(e) => updateLigne(l.id, 'recurrence', e.target.value)}>
                                    {RECURRENCES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                                </select>
                                <button
                                    type="button"
                                    className="btn btn--sm btn--danger btn--icon"
                                    onClick={() => removeLigne(l.id)}
                                    disabled={lignes.length === 1}
                                    style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                    title="Supprimer cette ligne"
                                >
                                    ×
                                </button>
                            </div>
                        ))}
                    </div>
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

            {/* Encaissement & Date de Paiement du Client */}
            <div className="card">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: withPayment ? 16 : 0 }}>
                    <input
                        type="checkbox"
                        id="with-payment"
                        checked={withPayment}
                        onChange={(e) => setWithPayment(e.target.checked)}
                        style={{ width: 16, height: 16, cursor: 'pointer' }}
                    />
                    <label htmlFor="with-payment" style={{ fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                        Enregistrer l'encaissement / règlement en même temps (le client a déjà payé)
                    </label>
                </div>

                {withPayment && (
                    <div style={{ paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                        <div className="form-row" style={{ marginBottom: 14 }}>
                            <div className="form-group">
                                <label className="form-label">Date à laquelle le client a payé *</label>
                                <input
                                    type="date"
                                    className="form-input"
                                    value={datePaiement}
                                    onChange={(e) => setDatePaiement(e.target.value)}
                                    required={withPayment}
                                />
                                <span className="form-hint">L'écriture de banque sera enregistrée à cette date exacte.</span>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Mode de règlement</label>
                                <select
                                    className="form-select"
                                    value={modePaiement}
                                    onChange={(e) => setModePaiement(e.target.value)}
                                >
                                    {MODES_PAIEMENT.map((m) => (
                                        <option key={m.value} value={m.value}>{m.label}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {modePaiement === 'stripe' ? (
                            <div className="form-row form-row--3">
                                <div className="form-group">
                                    <label className="form-label">Montant brut Stripe (€)</label>
                                    <input
                                        type="number" min="0.01" step="0.01" className="form-input"
                                        value={stripe.brut}
                                        onChange={(e) => setStripe((s) => ({ ...s, brut: e.target.value }))}
                                        placeholder="Ex. 100.00"
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Frais Stripe déduits (€)</label>
                                    <input
                                        type="number" min="0" step="0.01" className="form-input"
                                        value={stripe.frais}
                                        onChange={(e) => setStripe((s) => ({ ...s, frais: e.target.value }))}
                                        placeholder="Ex. 2.25"
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Net reçu en banque (€)</label>
                                    <input
                                        type="number" min="0.01" step="0.01" className="form-input"
                                        value={stripe.net}
                                        onChange={(e) => setStripe((s) => ({ ...s, net: e.target.value }))}
                                        placeholder="Auto-calculé"
                                    />
                                </div>
                            </div>
                        ) : (
                            <div className="form-group" style={{ maxWidth: 300 }}>
                                <label className="form-label">Montant net encaissé (€)</label>
                                <input
                                    type="number"
                                    min="0.01"
                                    step="0.01"
                                    className="form-input"
                                    placeholder={totalFacture ? totalFacture.toFixed(2) : '0.00'}
                                    value={montantRecuManuel}
                                    onChange={(e) => setMontantRecuManuel(e.target.value)}
                                />
                                <span className="form-hint">Par défaut le montant total de la facture ({formatMontant(totalFacture)}).</span>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Pièces Justificatives dans les Recettes */}
            <div className="card">
                <div className="card__title">Pièces justificatives (Facture émise, devis, reçu)</div>
                <p className="form-hint" style={{ marginBottom: 12 }}>
                    Joignez vos factures clients PDF ou justificatifs d'encaissement. Ils seront archivés et consultables sur l'opération.
                </p>
                <FileUpload
                    sourceType="facturation"
                    sourceId={null}
                    onUploaded={({ documentId }) => setDocumentIds((prev) => [...prev, documentId])}
                />
            </div>

            {/* Aperçu écritures comptables */}
            {totalFacture > 0 && (
                <div className="card" style={{ borderColor: 'var(--accent)' }}>
                    <div className="card__title">Écritures comptables générées</div>
                    <div className="table-wrap">
                        <table>
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Journal</th>
                                    <th>Compte</th>
                                    <th>Libellé</th>
                                    <th style={{ textAlign: 'right' }}>Débit</th>
                                    <th style={{ textAlign: 'right' }}>Crédit</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td rowSpan={2} style={{ fontSize: 12 }}>{date}</td>
                                    <td rowSpan={2} style={{ fontWeight: 600, fontSize: 11 }}>VT</td>
                                    <td><code>411</code></td>
                                    <td>Clients</td>
                                    <td style={{ textAlign: 'right' }}>{formatMontant(totalFacture)}</td>
                                    <td style={{ textAlign: 'right' }}>—</td>
                                </tr>
                                <tr>
                                    <td><code>706</code></td>
                                    <td>Prestations de services</td>
                                    <td style={{ textAlign: 'right' }}>—</td>
                                    <td style={{ textAlign: 'right' }}>{formatMontant(totalFacture)}</td>
                                </tr>

                                {withPayment && (
                                    <>
                                        {modePaiement === 'stripe' && strapeBrut > 0 ? (
                                            <>
                                                <tr style={{ borderTop: '2px dashed var(--border)' }}>
                                                    <td rowSpan={3} style={{ fontSize: 12 }}>{datePaiement || date}</td>
                                                    <td rowSpan={3} style={{ fontWeight: 600, fontSize: 11 }}>BQ</td>
                                                    <td><code>512</code></td>
                                                    <td>Banque</td>
                                                    <td style={{ textAlign: 'right' }}>{formatMontant(stripeNet)}</td>
                                                    <td style={{ textAlign: 'right' }}>—</td>
                                                </tr>
                                                <tr>
                                                    <td><code>6278</code></td>
                                                    <td>Frais Stripe</td>
                                                    <td style={{ textAlign: 'right' }}>{formatMontant(stripeFrags)}</td>
                                                    <td style={{ textAlign: 'right' }}>—</td>
                                                </tr>
                                                <tr>
                                                    <td><code>411</code></td>
                                                    <td>Clients</td>
                                                    <td style={{ textAlign: 'right' }}>—</td>
                                                    <td style={{ textAlign: 'right' }}>{formatMontant(strapeBrut)}</td>
                                                </tr>
                                            </>
                                        ) : (
                                            <tr style={{ borderTop: '2px dashed var(--border)' }}>
                                                <td rowSpan={2} style={{ fontSize: 12 }}>{datePaiement || date}</td>
                                                <td rowSpan={2} style={{ fontWeight: 600, fontSize: 11 }}>BQ</td>
                                                <td><code>512</code></td>
                                                <td>Banque</td>
                                                <td style={{ textAlign: 'right' }}>{formatMontant(parseFloat(montantRecuManuel) || totalFacture)}</td>
                                                <td style={{ textAlign: 'right' }}>—</td>
                                            </tr>
                                        )}
                                        {modePaiement !== 'stripe' && (
                                            <tr>
                                                <td><code>411</code></td>
                                                <td>Clients</td>
                                                <td style={{ textAlign: 'right' }}>—</td>
                                                <td style={{ textAlign: 'right' }}>{formatMontant(parseFloat(montantRecuManuel) || totalFacture)}</td>
                                            </tr>
                                        )}
                                    </>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            <button type="submit" className="btn btn--primary" disabled={saving} style={{ minWidth: 220 }}>
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
