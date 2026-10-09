/**
 * ModalRapprochementBancaire.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Rattache une transaction bancaire Shine importée à la comptabilité :
 * - Lien vers une écriture déjà saisie (évite les doublons)
 * - Recette client (nouvelle facturation ou facture en attente), frais déduits
 * - Dépense fournisseur (frais bancaires liés inclus)
 * - Apport / remboursement de compte courant d'associé
 * - Frais bancaires, ou écriture libre sur un compte au choix
 * Les montants et dates viennent du relevé : rien n'est ressaisi à la main.
 */
import { useState, useEffect } from 'react';
import { collection, getDocs, doc, getDoc, setDoc, updateDoc, addDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { ecrireEcriture, annulerEcriture } from '../services/api';
import { invalidateEcrituresCache, soldeCrediteurCompte } from '../services/comptaService';
import { invalidateCache } from '../services/dataCache';
import { majTransaction } from '../services/banqueService';
import { formatMontant, formatDate } from '../services/helpers';
import { RECURRENCES } from './FacturationClient';
import { CATEGORIES_DEPENSES } from './ModalModifierOperation';
import { DateInput } from './common/DateInput';
import { useRegimeTVA, tvaDepuisTTC } from '../services/tva';

const TYPES_CREDIT = [
    { id: 'recette', label: 'Recette client' },
    { id: 'cca', label: 'Apport associé (CCA)' },
    { id: 'autre', label: 'Autre' },
];
const TYPES_DEBIT = [
    { id: 'depense', label: 'Dépense' },
    { id: 'cca', label: 'Remboursement associé (CCA)' },
    { id: 'frais', label: 'Frais bancaires' },
    { id: 'autre', label: 'Autre' },
];

const COMPTES_SUGGERES = [
    { compte: '101', label: 'Capital social' },
    { compte: '4563', label: 'Associés - Versements reçus sur augmentation de capital' },
    { compte: '467', label: 'Autres comptes débiteurs ou créditeurs' },
    { compte: '455', label: 'Associés - Comptes courants' },
    { compte: '411', label: 'Clients' },
    { compte: '401', label: 'Fournisseurs' },
    { compte: '580', label: 'Virements internes' },
    { compte: '627', label: 'Services bancaires' },
    { compte: '758', label: 'Produits divers de gestion courante' },
    { compte: '768', label: 'Autres produits financiers' },
];

// Champs d'une facturation modifiés lors d'un encaissement (restaurés si on annule le rapprochement)
const CHAMPS_ENCAISSEMENT = [
    'withPayment', 'modePaiement', 'datePaiement', 'datePaiementStr', 'virementRecu', 'dateVirementStripe',
    'dateVirementStripeStr', 'withStripe', 'stripe', 'reglement', 'statut', 'ecriturePaiementId', 'ecritureStripeId',
];

function devinerModePaiement(tx) {
    if (/stripe/i.test(`${tx.contrepartie} ${tx.libelle}`)) return 'stripe';
    if (tx.type === 'Carte') return 'cb';
    if (/ch[eè]que/i.test(tx.type)) return 'cheque';
    return 'virement';
}

function devinerCategorie(tx, categories) {
    const txt = `${tx.categorieShine} ${tx.contrepartie} ${tx.libelle}`.toLowerCase();
    const has = (id) => categories.some((c) => c.id === id);
    if (/shine|banc|commission/.test(txt) && has('bancaire')) return 'bancaire';
    if (/serveur|cloud|ovh|h[ée]berg/.test(txt) && has('cloud')) return 'cloud';
    if (/logiciel|abonnement|saas/.test(txt)) return has('abonnements') ? 'abonnements' : 'saas';
    if (/restaurant|repas/.test(txt) && has('repas')) return 'repas';
    return categories[0]?.id || 'autre';
}

export function ModalRapprochementBancaire({ tx, commissions, correspondances, onClose, onSaved, onMarquerTraitee }) {
    const estCredit = tx.montant > 0;
    const totalCommissions = +commissions.reduce((s, c) => s + c.debit - c.credit, 0).toFixed(2);
    const montantBanque = Math.abs(tx.montant);
    // Effet net du mouvement et de ses commissions sur le compte bancaire
    const netBanque = +(tx.montant - totalCommissions).toFixed(2);

    const [type, setType] = useState(estCredit ? 'recette' : tx.type === 'Commission' ? 'frais' : 'depense');
    const [date, setDate] = useState(tx.date);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const [clients, setClients] = useState([]);
    const [associes, setAssocies] = useState([]);
    const [categories, setCategories] = useState(CATEGORIES_DEPENSES);
    const [facturesEnAttente, setFacturesEnAttente] = useState([]);

    // Recette
    const [clientId, setClientId] = useState('');
    const [clientNomLibre, setClientNomLibre] = useState(tx.contrepartie || '');
    const [recetteMode, setRecetteMode] = useState('nouvelle');
    const [factureId, setFactureId] = useState('');
    const [description, setDescription] = useState('');
    const [recurrence, setRecurrence] = useState('unique');
    const [modePaiement, setModePaiement] = useState(devinerModePaiement(tx));
    const [montantClient, setMontantClient] = useState(String(montantBanque));

    // Dépense
    const [fournisseur, setFournisseur] = useState(tx.contrepartie || tx.libelle);
    const [categorieId, setCategorieId] = useState('');
    const [activite, setActivite] = useState('wheeloh');
    const [depDescription, setDepDescription] = useState(tx.libelle);
    const [depClientId, setDepClientId] = useState('');

    // TVA (uniquement si la société est redevable)
    const regimeTVA = useRegimeTVA();
    const [tvaDepense, setTvaDepense] = useState(tx.tvaTotal ? String(tx.tvaTotal) : '');

    // CCA
    const [associeId, setAssocieId] = useState('');
    const [ccaDescription, setCcaDescription] = useState(tx.commentaire || tx.libelle);

    // Autre
    const [compteLibre, setCompteLibre] = useState('');
    const [libelleLibre, setLibelleLibre] = useState(tx.commentaire || tx.libelle);

    useEffect(() => {
        Promise.all([
            getDocs(collection(db, 'clients')),
            getDocs(collection(db, 'associes')),
            getDocs(collection(db, 'categoriesDepense')),
            getDocs(collection(db, 'facturations')),
        ]).then(([cl, as, cat, fac]) => {
            setClients(cl.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.nom || '').localeCompare(b.nom || '')));
            setAssocies(as.docs.map((d) => ({ id: d.id, ...d.data() })));
            const catsFirestore = cat.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0));
            const fusion = [...catsFirestore, ...CATEGORIES_DEPENSES.filter((c) => !catsFirestore.some((f) => f.id === c.id))];
            setCategories(fusion);
            setCategorieId(devinerCategorie(tx, fusion));
            setFacturesEnAttente(
                fac.docs.map((d) => ({ id: d.id, ...d.data() }))
                    .filter((f) => f.statut === 'en_attente' || f.statut === 'payee_stripe')
                    .sort((a, b) => (b.dateFacturation || '').localeCompare(a.dateFacturation || ''))
            );
        }).catch((e) => setError('Chargement impossible : ' + e.message));
    }, [tx]);

    const client = clients.find((c) => c.id === clientId);
    const nomClient = client ? `${client.nom} ${client.prenom ?? ''}`.trim() : (clientNomLibre.trim() || 'Client');
    const facturesProposees = clientId ? facturesEnAttente.filter((f) => f.clientId === clientId) : facturesEnAttente;
    const factureChoisie = facturesEnAttente.find((f) => f.id === factureId);

    // Pour une recette : le client a payé `brut`, la banque a reçu `netBanque`, la différence = frais
    const brut = parseFloat(montantClient) || 0;
    const fraisRecette = +(brut - netBanque).toFixed(2);

    const associe = associes.find((a) => a.id === associeId);
    const categorie = categories.find((c) => c.id === categorieId);

    // Pré-remplir le montant client avec la facture choisie
    useEffect(() => {
        if (factureChoisie?.totalFacture) setMontantClient(String(factureChoisie.totalFacture));
    }, [factureChoisie]);

    async function finaliser(rapprochement) {
        await majTransaction(tx.id, { statut: 'rapprochee', rapprochement: { ...rapprochement, at: new Date().toISOString() } });
        for (const c of commissions) {
            await majTransaction(c.id, { statut: 'rapprochee', rapprochement: { type: 'inclus', label: `Incluse dans : ${rapprochement.label}`, parentId: tx.id } });
        }
        invalidateEcrituresCache();
        onSaved?.();
    }

    async function lierEcriture(ec) {
        setSaving(true);
        setError('');
        try {
            await finaliser({ type: 'lien', label: `Déjà en compta : ${ec.libelle}`, ecritureIds: [ec.id], created: [], revert: [] });
        } catch (e) {
            setError(e.message);
            setSaving(false);
        }
    }

    async function ignorer() {
        setSaving(true);
        try {
            await majTransaction(tx.id, { statut: 'ignoree', rapprochement: { type: 'ignoree', label: 'Ignorée', at: new Date().toISOString() } });
            onSaved?.();
        } catch (e) {
            setError(e.message);
            setSaving(false);
        }
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setSaving(true);
        const ecritureIds = [];
        const created = [];
        const revert = [];

        try {
            if (!date) throw new Error('La date est requise.');
            const commissionsLib = commissions.length ? ` (+ ${formatMontant(totalCommissions)} de frais Shine)` : '';

            if (type === 'recette') {
                if (brut <= 0) throw new Error('Le montant payé par le client doit être positif.');
                if (fraisRecette < 0) throw new Error(`Le montant payé par le client ne peut pas être inférieur au montant reçu (${formatMontant(netBanque)}).`);
                if (recetteMode === 'existante' && !factureChoisie) throw new Error('Choisissez la facture réglée.');
                if (recetteMode === 'nouvelle' && !description.trim()) throw new Error('Décrivez la prestation facturée.');

                const estStripe = modePaiement === 'stripe';
                const libelleFact = `Facturation — ${recetteMode === 'existante' ? factureChoisie.clientNom : nomClient}`;
                const factRef = recetteMode === 'existante' ? doc(db, 'facturations', factureChoisie.id) : doc(collection(db, 'facturations'));

                // 1. Vente (nouvelle facture uniquement)
                let ecritureFactId = factureChoisie?.ecritureFactId ?? null;
                if (recetteMode === 'nouvelle') {
                    const { ecritureId } = await ecrireEcriture({
                        journal: 'VT',
                        date,
                        libelle: libelleFact,
                        sourceType: 'facturation',
                        sourceId: factRef.id,
                        mouvements: (() => {
                            // Régime réel : le montant payé est TTC → 706 HT + 44571 TVA collectée
                            const { ht, tva } = regimeTVA.franchise ? { ht: brut, tva: 0 } : tvaDepuisTTC(brut, regimeTVA.taux);
                            return [
                                { compte: '411', libelle: nomClient, debit: brut, credit: 0 },
                                { compte: '706', libelle: 'Prestations de services', debit: 0, credit: ht },
                                ...(tva > 0 ? [{ compte: '44571', libelle: `TVA collectée (${regimeTVA.taux} %)`, debit: 0, credit: tva }] : []),
                            ];
                        })(),
                    });
                    ecritureFactId = ecritureId;
                    ecritureIds.push(ecritureId);
                }

                // 2. Encaissement : banque au net, frais en charge, client soldé du brut
                const { ecritureId: ecritureBQ } = await ecrireEcriture({
                    journal: 'BQ',
                    date,
                    libelle: estStripe ? `Virement Stripe vers compte bancaire — ${libelleFact}` : `Règlement reçu (${modePaiement}) — ${libelleFact}`,
                    sourceType: 'facturation',
                    sourceId: factRef.id,
                    pieceRef: `SHINE-${tx.id.slice(0, 8)}`,
                    mouvements: [
                        { compte: '512', libelle: 'Banque', debit: netBanque, credit: 0 },
                        ...(fraisRecette > 0
                            ? [{ compte: estStripe ? '6278' : '627', libelle: estStripe ? 'Frais Stripe' : `Frais de transaction (${modePaiement})`, debit: fraisRecette, credit: 0 }]
                            : []),
                        { compte: '411', libelle: recetteMode === 'existante' ? factureChoisie.clientNom : nomClient, debit: 0, credit: brut },
                    ],
                });
                ecritureIds.push(ecritureBQ);

                const paiement = { brut, frais: fraisRecette, net: netBanque };
                const champsEncaissement = {
                    withPayment: true,
                    modePaiement,
                    datePaiement: new Date(date),
                    datePaiementStr: date,
                    virementRecu: true,
                    dateVirementStripe: estStripe ? new Date(date) : null,
                    dateVirementStripeStr: estStripe ? date : null,
                    withStripe: estStripe,
                    stripe: estStripe ? paiement : null,
                    reglement: estStripe ? null : paiement,
                    statut: 'encaissee',
                    ecriturePaiementId: ecritureBQ,
                    ecritureStripeId: ecritureBQ,
                    updatedAt: serverTimestamp(),
                };

                if (recetteMode === 'existante') {
                    const snap = await getDoc(factRef);
                    const avant = snap.data() || {};
                    revert.push({ col: 'facturations', id: factRef.id, fields: Object.fromEntries(CHAMPS_ENCAISSEMENT.map((k) => [k, avant[k] ?? null])) });
                    await updateDoc(factRef, champsEncaissement);
                } else {
                    const rec = RECURRENCES.find((r) => r.value === recurrence);
                    await setDoc(factRef, {
                        clientId: clientId || null,
                        clientNom: nomClient,
                        date: new Date(date),
                        dateFacturation: date,
                        lignes: [{ description: description.trim(), dateDebut: date, quantite: 1, prixUnitaire: brut, recurrence, total: brut }],
                        description: description.trim(),
                        notes: `Créée depuis le relevé Shine (${tx.libelle})`,
                        totalOneShot: recurrence === 'unique' ? brut : 0,
                        mrr: recurrence === 'unique' ? 0 : +(brut * (rec?.coefMRR ?? 0)).toFixed(2),
                        totalFacture: brut,
                        ecritureFactId,
                        documentIds: [],
                        banqueTransactionId: tx.id,
                        ...champsEncaissement,
                        createdAt: serverTimestamp(),
                    });
                    created.push({ col: 'facturations', id: factRef.id });
                }
                invalidateCache('facturations');

                await finaliser({ type: 'recette', label: `Recette ${libelleFact.replace('Facturation — ', '')}`, ecritureIds, created, revert });
            } else if (type === 'depense') {
                if (!fournisseur.trim()) throw new Error('Le fournisseur est requis.');
                if (!categorie) throw new Error('Choisissez une catégorie.');
                const fNom = fournisseur.trim();
                const actLabel = activite === 'site-chateau' ? 'site-chateau.fr' : activite === 'commun' ? 'Commun' : 'Wheeloh';
                const libelleDepense = `[${actLabel}] ${categorie.label} — ${depDescription.trim() || fNom}`;
                const depRef = doc(collection(db, 'depenses'));

                const { ecritureId: ecDep } = await ecrireEcriture({
                    journal: 'AC',
                    date,
                    libelle: libelleDepense,
                    sourceType: 'depense',
                    sourceId: depRef.id,
                    mouvements: (() => {
                        const tva = regimeTVA.franchise ? 0 : Math.min(Math.max(parseFloat(tvaDepense) || 0, 0), montantBanque);
                        return [
                            { compte: categorie.compte, libelle: `Charge — ${fNom}`, debit: +(montantBanque - tva).toFixed(2), credit: 0 },
                            ...(tva > 0 ? [{ compte: '44566', libelle: 'TVA déductible sur autres biens et services', debit: tva, credit: 0 }] : []),
                            { compte: '401', libelle: fNom, debit: 0, credit: montantBanque },
                        ];
                    })(),
                });
                const { ecritureId: ecPay } = await ecrireEcriture({
                    journal: 'BQ',
                    date,
                    libelle: `Paiement [${actLabel}] ${categorie.label} — ${fNom}${commissionsLib}`,
                    sourceType: 'depense',
                    sourceId: depRef.id,
                    pieceRef: `SHINE-${tx.id.slice(0, 8)}`,
                    mouvements: [
                        { compte: '401', libelle: fNom, debit: montantBanque, credit: 0 },
                        ...(totalCommissions > 0 ? [{ compte: '627', libelle: 'Commission bancaire Shine', debit: totalCommissions, credit: 0 }] : []),
                        { compte: '512', libelle: 'Banque', debit: 0, credit: +(montantBanque + totalCommissions).toFixed(2) },
                    ],
                });
                ecritureIds.push(ecDep, ecPay);

                const clientProjet = clients.find((c) => c.id === depClientId);
                await setDoc(depRef, {
                    fournisseurId: null,
                    fournisseurNom: fNom,
                    description: depDescription.trim(),
                    montant: montantBanque,
                    activite,
                    activiteLabel: actLabel,
                    categorieId,
                    categorieLabel: categorie.label,
                    categorieCompte: categorie.compte,
                    motif: null,
                    clientProjetId: depClientId || null,
                    clientProjetNom: clientProjet?.nom ?? null,
                    clientId: depClientId || null,
                    clientNom: clientProjet?.nom ?? null,
                    dateDépense: new Date(date),
                    statut: 'payee',
                    datePaiement: new Date(date),
                    tvaDéductible: !regimeTVA.franchise && (parseFloat(tvaDepense) || 0) > 0,
                    tauxTVA: null,
                    montantHT: !regimeTVA.franchise && (parseFloat(tvaDepense) || 0) > 0 ? +(montantBanque - (parseFloat(tvaDepense) || 0)).toFixed(2) : null,
                    montantTVA: !regimeTVA.franchise && (parseFloat(tvaDepense) || 0) > 0 ? +(parseFloat(tvaDepense) || 0).toFixed(2) : null,
                    recurrence: { type: 'ponctuel' },
                    ecritureDepenseIds: [ecDep],
                    ecriturePaiementIds: [ecPay],
                    documentIds: [],
                    banqueTransactionId: tx.id,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                });
                created.push({ col: 'depenses', id: depRef.id });
                invalidateCache('depenses');

                await finaliser({ type: 'depense', label: `Dépense ${fNom} (${categorie.label})`, ecritureIds, created, revert });
            } else if (type === 'cca') {
                if (!associe) throw new Error('Choisissez l\'associé.');
                const nomAss = `${associe.nom} ${associe.prenom || ''}`.trim();
                const compteCC = associe.compteCC || '455';
                const apport = estCredit;
                if (!apport) {
                    const solde = await soldeCrediteurCompte(compteCC, date);
                    if (montantBanque > solde + 0.005) {
                        throw new Error(`Le compte courant de ${nomAss} n'est créditeur que de ${formatMontant(Math.max(solde, 0))} : ce remboursement le rendrait débiteur (interdit pour un dirigeant de SAS, art. L227-12 C. com.). Vérifiez l'associé ou enregistrez l'opération autrement.`);
                    }
                }
                const { ecritureId } = await ecrireEcriture({
                    journal: 'BQ',
                    date,
                    libelle: `${apport ? 'Apport' : 'Remboursement'} CCA — ${nomAss} — ${ccaDescription.trim()}`,
                    sourceType: apport ? 'cca_apport' : 'cca_remboursement',
                    pieceRef: `SHINE-${tx.id.slice(0, 8)}`,
                    mouvements: apport
                        ? [
                            { compte: '512', libelle: `Banque — Apport ${nomAss}`, debit: montantBanque, credit: 0 },
                            { compte: compteCC, libelle: `Compte courant ${nomAss}`, debit: 0, credit: montantBanque },
                        ]
                        : [
                            { compte: compteCC, libelle: `Compte courant ${nomAss}`, debit: montantBanque, credit: 0 },
                            { compte: '512', libelle: `Banque — Remboursement ${nomAss}`, debit: 0, credit: montantBanque },
                        ],
                });
                ecritureIds.push(ecritureId);
                const mvtRef = await addDoc(collection(db, 'ccaMouvements'), {
                    associeId,
                    associeNom: nomAss,
                    type: apport ? 'apport' : 'remboursement',
                    montant: montantBanque,
                    dateMouvement: new Date(date),
                    description: ccaDescription.trim(),
                    taux: null,
                    documentIds: [],
                    ecritureId,
                    banqueTransactionId: tx.id,
                    createdAt: serverTimestamp(),
                });
                await updateDoc(doc(db, 'ecritures', ecritureId), { sourceId: mvtRef.id });
                created.push({ col: 'ccaMouvements', id: mvtRef.id });
                invalidateCache('ccaMouvements');

                await finaliser({ type: 'cca', label: `${apport ? 'Apport' : 'Remboursement'} CCA ${nomAss}`, ecritureIds, created, revert });
            } else {
                // Frais bancaires ou écriture libre : 512 contre un compte de contrepartie
                const compte = type === 'frais' ? '627' : compteLibre.trim();
                if (!compte) throw new Error('Indiquez le compte de contrepartie.');
                const libelle = type === 'frais' ? `Frais bancaires — ${tx.libelle}` : (libelleLibre.trim() || tx.libelle);
                const montantTotal = Math.abs(netBanque);
                const mvtContrepartie = { compte, libelle, debit: netBanque < 0 ? montantTotal : 0, credit: netBanque > 0 ? montantTotal : 0 };
                const { ecritureId } = await ecrireEcriture({
                    journal: 'BQ',
                    date,
                    libelle,
                    sourceType: type === 'frais' ? 'frais_bancaires' : 'banque',
                    pieceRef: `SHINE-${tx.id.slice(0, 8)}`,
                    mouvements: [
                        { compte: '512', libelle: 'Banque', debit: netBanque > 0 ? montantTotal : 0, credit: netBanque < 0 ? montantTotal : 0 },
                        mvtContrepartie,
                    ],
                });
                ecritureIds.push(ecritureId);
                await finaliser({ type, label: type === 'frais' ? 'Frais bancaires' : `Compte ${compte} — ${libelle}`, ecritureIds, created, revert });
            }
        } catch (err) {
            console.error('Rapprochement bancaire :', err);
            setError(
                err.message
                + (ecritureIds.length ? ` (${ecritureIds.length} écriture(s) déjà créée(s) : vérifiez le journal BQ avant de réessayer.)` : '')
            );
            setSaving(false);
        }
    }

    const types = estCredit ? TYPES_CREDIT : TYPES_DEBIT;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" style={{ maxWidth: 760 }} onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <div>
                        <h3 style={{ margin: 0, fontSize: 16 }}>Rattacher la transaction</h3>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                            {formatDate(tx.date)} · {tx.type} · {tx.contrepartie || tx.libelle}
                        </div>
                    </div>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={onClose} aria-label="Fermer">✕</button>
                </div>

                <form onSubmit={handleSubmit} style={{ display: 'contents' }}>
                    <div className="modal-body">
                        {error && <div className="notice notice--danger" style={{ marginBottom: 12 }}>{error}</div>}

                        {/* Résumé du mouvement */}
                        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 14px', marginBottom: 16 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
                                <div style={{ fontSize: 13 }}>{tx.libelle}</div>
                                <div style={{ fontSize: 18, fontWeight: 700, color: estCredit ? 'var(--success)' : 'var(--text)', whiteSpace: 'nowrap' }}>
                                    {estCredit ? '+' : '−'}{formatMontant(montantBanque)}
                                </div>
                            </div>
                            {commissions.map((c) => (
                                <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                                    <span>{c.contrepartie || c.libelle} (commission liée)</span>
                                    <span>−{formatMontant(c.debit)}</span>
                                </div>
                            ))}
                            {commissions.length > 0 && (
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 600, marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--border)' }}>
                                    <span>Net sur le compte</span>
                                    <span>{netBanque > 0 ? '+' : '−'}{formatMontant(Math.abs(netBanque))}</span>
                                </div>
                            )}
                            {tx.commentaire && (
                                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8, whiteSpace: 'pre-line' }}>
                                    Note Shine : {tx.commentaire}
                                </div>
                            )}
                        </div>

                        {/* Correspondances déjà en compta */}
                        {correspondances.length > 0 && (
                            <div className="notice notice--info" style={{ display: 'block', marginBottom: 16 }}>
                                <div style={{ fontWeight: 600, marginBottom: 8 }}>Ce mouvement semble déjà saisi dans la compta :</div>
                                {correspondances.slice(0, 4).map((ec) => (
                                    <div key={ec.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '6px 0', borderTop: '1px solid var(--border)' }}>
                                        <div style={{ fontSize: 12 }}>
                                            <div style={{ fontWeight: 600 }}>{ec.libelle}</div>
                                            <div style={{ color: 'var(--text-muted)' }}>
                                                {formatDate(ec.dateObj)} · Journal {ec.journal} · {formatMontant(Math.abs(ec.delta512))}
                                                {ec.ecartJours > 0 && ` · ${ec.ecartJours} j d'écart`}
                                            </div>
                                        </div>
                                        <button type="button" className="btn btn--primary btn--sm" disabled={saving} onClick={() => lierEcriture(ec)}>
                                            Lier
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Nature de l'opération */}
                        <div className="form-label" style={{ marginBottom: 8 }}>
                            {correspondances.length > 0 ? 'Sinon, enregistrer comme :' : 'Enregistrer comme :'}
                        </div>
                        <div className="view-tabs" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
                            {types.map((t) => (
                                <button
                                    key={t.id}
                                    type="button"
                                    className={`view-tab-btn ${type === t.id ? 'view-tab-btn--active' : ''}`}
                                    onClick={() => setType(t.id)}
                                >
                                    {t.label}
                                </button>
                            ))}
                        </div>

                        <div className="form-group" style={{ maxWidth: 220 }}>
                            <label className="form-label">Date comptable</label>
                            <DateInput className="form-input" value={date} onChange={(e) => setDate(e.target.value)} />
                        </div>

                        {type === 'recette' && (
                            <div>
                                <div className="form-row">
                                    <div className="form-group">
                                        <label className="form-label">Client</label>
                                        <select className="form-select" value={clientId} onChange={(e) => { setClientId(e.target.value); setFactureId(''); }}>
                                            <option value="">Client libre (nom ci-dessous)</option>
                                            {clients.map((c) => <option key={c.id} value={c.id}>{`${c.nom} ${c.prenom ?? ''}`.trim()}</option>)}
                                        </select>
                                        {!clientId && (
                                            <input className="form-input" style={{ marginTop: 6 }} value={clientNomLibre} onChange={(e) => setClientNomLibre(e.target.value)} placeholder="Nom du client" />
                                        )}
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Moyen de paiement</label>
                                        <select className="form-select" value={modePaiement} onChange={(e) => setModePaiement(e.target.value)}>
                                            <option value="stripe">Stripe (virement de payout)</option>
                                            <option value="cb">Carte bancaire</option>
                                            <option value="virement">Virement bancaire</option>
                                            <option value="cheque">Chèque</option>
                                            <option value="autre">Autre</option>
                                        </select>
                                    </div>
                                </div>

                                <div className="form-group">
                                    <label style={{ display: 'flex', gap: 16, fontSize: 13 }}>
                                        <span style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                                            <input type="radio" checked={recetteMode === 'nouvelle'} onChange={() => setRecetteMode('nouvelle')} />
                                            Nouvelle facture
                                        </span>
                                        <span style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                                            <input type="radio" checked={recetteMode === 'existante'} onChange={() => setRecetteMode('existante')} />
                                            Règlement d'une facture en attente ({facturesProposees.length})
                                        </span>
                                    </label>
                                </div>

                                {recetteMode === 'nouvelle' ? (
                                    <div className="form-row">
                                        <div className="form-group">
                                            <label className="form-label">Prestation facturée</label>
                                            <input className="form-input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex. Site internet, abonnement..." />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">Récurrence</label>
                                            <select className="form-select" value={recurrence} onChange={(e) => setRecurrence(e.target.value)}>
                                                {RECURRENCES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                                            </select>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="form-group">
                                        <label className="form-label">Facture réglée</label>
                                        <select className="form-select" value={factureId} onChange={(e) => setFactureId(e.target.value)}>
                                            <option value="">Choisir une facture...</option>
                                            {facturesProposees.map((f) => (
                                                <option key={f.id} value={f.id}>
                                                    {formatDate(f.dateFacturation || f.date)} — {f.clientNom} — {formatMontant(f.totalFacture)}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                <div className="form-row form-row--3">
                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                        <label className="form-label">Payé par le client (€)</label>
                                        <input type="number" step="0.01" min="0.01" className="form-input" value={montantClient} onChange={(e) => setMontantClient(e.target.value)} />
                                        {modePaiement === 'stripe' && <span className="form-hint">Prix facturé, avant frais Stripe.</span>}
                                    </div>
                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                        <label className="form-label">Frais déduits</label>
                                        <input className="form-input" readOnly value={formatMontant(Math.max(fraisRecette, 0))} />
                                    </div>
                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                        <label className="form-label">Reçu sur le compte</label>
                                        <input className="form-input" readOnly value={formatMontant(netBanque)} />
                                    </div>
                                </div>
                            </div>
                        )}

                        {type === 'depense' && (
                            <div>
                                <div className="form-row">
                                    <div className="form-group">
                                        <label className="form-label">Fournisseur</label>
                                        <input className="form-input" value={fournisseur} onChange={(e) => setFournisseur(e.target.value)} />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Catégorie</label>
                                        <select className="form-select" value={categorieId} onChange={(e) => setCategorieId(e.target.value)}>
                                            {categories.map((c) => <option key={c.id} value={c.id}>{c.label} (compte {c.compte})</option>)}
                                        </select>
                                    </div>
                                </div>
                                <div className="form-row">
                                    <div className="form-group">
                                        <label className="form-label">Description</label>
                                        <input className="form-input" value={depDescription} onChange={(e) => setDepDescription(e.target.value)} />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Activité</label>
                                        <select className="form-select" value={activite} onChange={(e) => setActivite(e.target.value)}>
                                            <option value="wheeloh">Wheeloh</option>
                                            <option value="site-chateau">site-chateau.fr</option>
                                            <option value="commun">Frais généraux / Commun</option>
                                        </select>
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Client / projet concerné (optionnel)</label>
                                    <select className="form-select" value={depClientId} onChange={(e) => setDepClientId(e.target.value)}>
                                        <option value="">Aucun</option>
                                        {clients.map((c) => <option key={c.id} value={c.id}>{`${c.nom} ${c.prenom ?? ''}`.trim()}</option>)}
                                    </select>
                                </div>
                                {!regimeTVA.franchise && (
                                    <div className="form-group" style={{ maxWidth: 260 }}>
                                        <label className="form-label">Dont TVA déductible (€)</label>
                                        <input type="number" step="0.01" min="0" className="form-input" value={tvaDepense} onChange={(e) => setTvaDepense(e.target.value)} placeholder="0.00" />
                                        <span className="form-hint">Pré-rempli avec la TVA indiquée par Shine ; à vérifier sur la facture du fournisseur.</span>
                                    </div>
                                )}
                                {totalCommissions > 0 && (
                                    <p className="form-hint">
                                        La commission Shine liée ({formatMontant(totalCommissions)}) sera comptée en frais bancaires (627) dans le même paiement.
                                    </p>
                                )}
                            </div>
                        )}

                        {type === 'cca' && (
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Associé</label>
                                    <select className="form-select" value={associeId} onChange={(e) => setAssocieId(e.target.value)}>
                                        <option value="">Choisir...</option>
                                        {associes.map((a) => (
                                            <option key={a.id} value={a.id}>{`${a.nom} ${a.prenom || ''}`.trim()} (compte {a.compteCC || '455'})</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Description</label>
                                    <input className="form-input" value={ccaDescription} onChange={(e) => setCcaDescription(e.target.value)} />
                                </div>
                            </div>
                        )}

                        {type === 'frais' && (
                            <p className="form-hint">
                                Écriture : débit 627 (services bancaires) / crédit 512 (banque) pour {formatMontant(Math.abs(netBanque))}.
                            </p>
                        )}

                        {type === 'autre' && (
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Compte de contrepartie</label>
                                    <input className="form-input" list="comptes-suggeres" value={compteLibre} onChange={(e) => setCompteLibre(e.target.value)} placeholder="Ex. 101, 455, 758..." />
                                    <datalist id="comptes-suggeres">
                                        {COMPTES_SUGGERES.map((c) => <option key={c.compte} value={c.compte}>{c.label}</option>)}
                                    </datalist>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Libellé</label>
                                    <input className="form-input" value={libelleLibre} onChange={(e) => setLibelleLibre(e.target.value)} />
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', gap: 6 }}>
                            <button type="button" className="btn btn--ghost" onClick={ignorer} disabled={saving} title="Transaction personnelle ou sans impact comptable">
                                Ignorer
                            </button>
                            {onMarquerTraitee && (
                                <button
                                    type="button"
                                    className="btn btn--ghost"
                                    onClick={() => { setSaving(true); onMarquerTraitee(); }}
                                    disabled={saving}
                                    title="La compta contient déjà cette opération (saisie à la main), rien ne sera créé"
                                >
                                    Déjà saisie en compta
                                </button>
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: 10 }}>
                            <button type="button" className="btn btn--ghost" onClick={onClose} disabled={saving}>Annuler</button>
                            <button type="submit" className="btn btn--primary" disabled={saving}>
                                {saving ? 'Enregistrement...' : 'Enregistrer'}
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
}

/**
 * Défait un rapprochement : annule les écritures créées, supprime les documents créés,
 * restaure les factures modifiées et remet la transaction (et ses commissions) à traiter.
 */
export async function annulerRapprochement(tx, commissions) {
    const r = tx.rapprochement || {};
    if (r.type !== 'lien') {
        // Brouillard : écriture retirée ; écriture validée : contre-passation
        for (const id of r.ecritureIds || []) {
            await annulerEcriture(id, 'Rapprochement bancaire défait');
        }
    }
    for (const c of r.created || []) {
        await deleteDoc(doc(db, c.col, c.id));
        invalidateCache(c.col);
    }
    for (const rv of r.revert || []) {
        await updateDoc(doc(db, rv.col, rv.id), rv.fields);
        invalidateCache(rv.col);
    }
    await majTransaction(tx.id, { statut: 'a_traiter', rapprochement: null });
    for (const c of commissions) {
        await majTransaction(c.id, { statut: 'a_traiter', rapprochement: null });
    }
    invalidateEcrituresCache();
}
