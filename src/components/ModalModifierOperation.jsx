/**
 * ModalModifierOperation.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Modal universel de modification d'opération comptable.
 * Permet de modifier n'importe quelle écriture du Grand Livre ou transaction avec
 * le FORMULAIRE EXACT de création selon sa nature :
 * - Dépense (Activité Wheeloh / site-chateau.fr / Commun, Montant, Date, Catégorie, Fournisseur, TVA, Justificatifs)
 * - Mouvement de Compte Courant d'Associé (CCA Apport / Remboursement, Date, Montant, Taux, Associé)
 * - Capital initial (Montant, Date exacte, Banque dépositaire)
 * - Facture client (Client, Date, Montant, TVA, Encaissement)
 * - Écriture comptable générale / OD (Partie double Débit / Crédit)
 * 
 * Répercute immédiatement les modifications sur :
 * 1. Le document métier source (depenses, ccaMouvements, factures, settings)
 * 2. L'écriture comptable équilibrée associée dans le Grand Livre (ecritures)
 * 3. Les pièces justificatives rattachées
 */

import { useState, useEffect, useCallback } from 'react';
import {
    doc,
    getDoc,
    updateDoc,
    deleteDoc,
    collection,
    query,
    where,
    getDocs,
    serverTimestamp,
    addDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import { invalidateEcrituresCache } from '../services/comptaService';
import { invalidateCache } from '../services/dataCache';
import { formatMontant, formatDate, calculerTTCdepuisHT } from '../services/helpers';
import { FileUpload } from './FileUpload';

const CATEGORIES_DEPENSES = [
    { id: 'saas', label: 'Logiciels & SaaS', compte: '6135' },
    { id: 'cloud', label: 'Hébergement Cloud', compte: '6135' },
    { id: 'materiel', label: 'Matériel informatique', compte: '2183' },
    { id: 'fournitures', label: 'Fournitures de bureau', compte: '6064' },
    { id: 'compta', label: 'Expert-comptable & Avocat', compte: '6226' },
    { id: 'pub', label: 'Marketing & Publicité', compte: '6231' },
    { id: 'deplacement', label: 'Transports & Déplacements', compte: '6251' },
    { id: 'repas', label: 'Missions & Réceptions', compte: '6257' },
    { id: 'bancaire', label: 'Frais bancaires & Commissions', compte: '627' },
    { id: 'assurance', label: 'Assurance professionnelle', compte: '616' },
    { id: 'telecom', label: 'Télécoms & Internet', compte: '626' },
    { id: 'autre', label: 'Autres charges externes', compte: '6068' },
];

export function ModalModifierOperation({ ecritureId, sourceId, sourceType, onClose, onSaved }) {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [successMsg, setSuccessMsg] = useState('');

    // Données de base détectées
    const [operationType, setOperationType] = useState(sourceType || null); // 'depense' | 'cca' | 'capital_initial' | 'facture' | 'od'
    const [activeEcriture, setActiveEcriture] = useState(null);
    const [sourceData, setSourceData] = useState(null);
    const [actualSourceId, setActualSourceId] = useState(sourceId || null);

    // Listes de référence
    const [associes, setAssocies] = useState([]);
    const [fournisseurs, setFournisseurs] = useState([]);
    const [clients, setClients] = useState([]);

    // Pièces justificatives
    const [documentIds, setDocumentIds] = useState([]);
    const [existingDocs, setExistingDocs] = useState([]);

    // ─── État Formulaire DÉPENSE ───
    const [depActivite, setDepActivite] = useState('wheeloh');
    const [depDate, setDepDate] = useState('');
    const [depFournisseurNom, setDepFournisseurNom] = useState('');
    const [depCategorieId, setDepCategorieId] = useState('saas');
    const [depDescription, setDepDescription] = useState('');
    const [depMotif, setDepMotif] = useState('');
    const [depMontant, setDepMontant] = useState('');
    const [depTvaOn, setDepTvaOn] = useState(false);
    const [depTauxTVA, setDepTauxTVA] = useState(20);
    const [depDejaPayee, setDepDejaPayee] = useState(true);
    const [depDatePaiement, setDepDatePaiement] = useState('');

    // ─── État Formulaire CCA ───
    const [ccaAssocieId, setCcaAssocieId] = useState('');
    const [ccaType, setCcaType] = useState('apport'); // 'apport' | 'remboursement'
    const [ccaMontant, setCcaMontant] = useState('');
    const [ccaDate, setCcaDate] = useState('');
    const [ccaTaux, setCcaTaux] = useState('');
    const [ccaDescription, setCcaDescription] = useState('');

    // ─── État Formulaire CAPITAL INITIAL ───
    const [capMontant, setCapMontant] = useState('');
    const [capDate, setCapDate] = useState('');
    const [capBanque, setCapBanque] = useState('');

    // ─── État Formulaire FACTURE CLIENT ───
    const [facClientId, setFacClientId] = useState('');
    const [facClientNom, setFacClientNom] = useState('');
    const [facDate, setFacDate] = useState('');
    const [facDescription, setFacDescription] = useState('');
    const [facMontantHT, setFacMontantHT] = useState('');
    const [facTvaOn, setFacTvaOn] = useState(false);
    const [facTauxTVA, setFacTauxTVA] = useState(20);
    const [facStatut, setFacStatut] = useState('encaissee');
    const [facDateEnc, setFacDateEnc] = useState('');
    const [facDatePaiement, setFacDatePaiement] = useState('');
    const [facDateVirementStripe, setFacDateVirementStripe] = useState('');

    // ─── État Formulaire ÉCRITURE GÉNÉRALE (OD / autre) ───
    const [genDate, setGenDate] = useState('');
    const [genLibelle, setGenLibelle] = useState('');
    const [genPieceRef, setGenPieceRef] = useState('');
    const [genMouvements, setGenMouvements] = useState([]);

    // 1. Chargement initial
    const loadOperation = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            // Charger les tables référentielles
            const [assSnap, fourSnap, clSnap] = await Promise.all([
                getDocs(collection(db, 'associes')),
                getDocs(collection(db, 'fournisseurs')),
                getDocs(collection(db, 'clients')),
            ]);
            setAssocies(assSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
            setFournisseurs(fourSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
            setClients(clSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

            let ecData = null;
            let sType = operationType;
            let sId = actualSourceId;

            // Charger l'écriture si on a ecritureId
            if (ecritureId) {
                const ecSnap = await getDoc(doc(db, 'ecritures', ecritureId));
                if (ecSnap.exists()) {
                    ecData = { id: ecSnap.id, ...ecSnap.data() };
                    setActiveEcriture(ecData);
                    if (!sType) sType = ecData.sourceType;
                    if (!sId) sId = ecData.sourceId;
                }
            }

            // Détection du type
            if (!sType && ecData) {
                if (ecData.pieceRef === 'STATUTS' || ecData.libelle?.toLowerCase().includes('capital social')) {
                    sType = 'capital_initial';
                } else if (ecData.journal === 'AC') {
                    sType = 'depense';
                } else if (ecData.journal === 'VE' || ecData.journal === 'VT' || ecData.sourceType === 'facturation') {
                    sType = 'facture';
                } else if (ecData.libelle?.toLowerCase().includes('cca') || ecData.mouvements?.some((m) => m.compte?.startsWith('455'))) {
                    sType = 'cca';
                } else {
                    sType = 'od';
                }
            }

            if (sType?.startsWith('cca')) {
                sType = 'cca';
            }
            if (sType === 'facturation') {
                sType = 'facture';
            }

            setOperationType(sType || 'depense');
            setActualSourceId(sId);

            // Charger les détails métier spécifiques
            if (sType === 'depense') {
                let depData = null;
                if (sId) {
                    const dSnap = await getDoc(doc(db, 'depenses', sId));
                    if (dSnap.exists()) depData = { id: dSnap.id, ...dSnap.data() };
                } else if (ecritureId) {
                    // Trouver la dépense qui référence cette écriture
                    const qDep = query(collection(db, 'depenses'), where('ecritureDepenseIds', 'array-contains', ecritureId));
                    const qSnap = await getDocs(qDep);
                    if (!qSnap.empty) {
                        depData = { id: qSnap.docs[0].id, ...qSnap.docs[0].data() };
                        setActualSourceId(depData.id);
                    }
                }

                if (depData) {
                    setSourceData(depData);
                    setDepActivite(depData.activite || 'wheeloh');
                    const dDate = depData.dateDépense?.toDate ? depData.dateDépense.toDate() : new Date(depData.dateDépense || Date.now());
                    setDepDate(!isNaN(dDate) ? dDate.toISOString().split('T')[0] : '');
                    setDepFournisseurNom(depData.fournisseurNom || '');
                    setDepCategorieId(depData.categorieId || 'saas');
                    setDepDescription(depData.description || '');
                    setDepMotif(depData.motif || '');
                    setDepMontant(depData.montant ? String(depData.montant) : '');
                    setDepTvaOn(!!depData.tvaDéductible);
                    setDepTauxTVA(depData.tauxTVA || 20);
                    setDepDejaPayee(depData.statut === 'payee');
                    const pDate = depData.datePaiement?.toDate ? depData.datePaiement.toDate() : depData.datePaiement ? new Date(depData.datePaiement) : null;
                    setDepDatePaiement(pDate && !isNaN(pDate) ? pDate.toISOString().split('T')[0] : '');
                    setDocumentIds(depData.documentIds || []);
                } else if (ecData) {
                    // Fallback sur les données de l'écriture
                    const ecDate = ecData.date?.toDate ? ecData.date.toDate() : new Date(ecData.date || Date.now());
                    setDepDate(!isNaN(ecDate) ? ecDate.toISOString().split('T')[0] : '');
                    setDepDescription(ecData.libelle || '');
                    const mvt401 = ecData.mouvements?.find((m) => m.compte === '401');
                    if (mvt401) {
                        setDepFournisseurNom(mvt401.libelle || '');
                        setDepMontant(String(mvt401.credit || mvt401.debit || ''));
                    }
                }
            } else if (sType === 'cca') {
                let ccaData = null;
                if (sId) {
                    const cSnap = await getDoc(doc(db, 'ccaMouvements', sId));
                    if (cSnap.exists()) ccaData = { id: cSnap.id, ...cSnap.data() };
                } else if (ecritureId) {
                    const qCca = query(collection(db, 'ccaMouvements'), where('ecritureId', '==', ecritureId));
                    const qSnap = await getDocs(qCca);
                    if (!qSnap.empty) {
                        ccaData = { id: qSnap.docs[0].id, ...qSnap.docs[0].data() };
                        setActualSourceId(ccaData.id);
                    }
                }

                if (ccaData) {
                    setSourceData(ccaData);
                    setCcaAssocieId(ccaData.associeId || '');
                    setCcaType(ccaData.type === 'remboursement' ? 'remboursement' : 'apport');
                    setCcaMontant(ccaData.montant ? String(ccaData.montant) : '');
                    const cDate = ccaData.dateMouvement?.toDate ? ccaData.dateMouvement.toDate() : new Date(ccaData.dateMouvement || Date.now());
                    setCcaDate(!isNaN(cDate) ? cDate.toISOString().split('T')[0] : '');
                    setCcaTaux(ccaData.taux ? String(ccaData.taux) : '');
                    setCcaDescription(ccaData.description || '');
                    setDocumentIds(ccaData.documentIds || []);
                } else if (ecData) {
                    const ecDate = ecData.date?.toDate ? ecData.date.toDate() : new Date(ecData.date || Date.now());
                    setCcaDate(!isNaN(ecDate) ? ecDate.toISOString().split('T')[0] : '');
                    setCcaDescription(ecData.libelle || '');
                    const mvt512 = ecData.mouvements?.find((m) => m.compte === '512');
                    if (mvt512) {
                        setCcaType(mvt512.debit > 0 ? 'apport' : 'remboursement');
                        setCcaMontant(String(mvt512.debit || mvt512.credit || ''));
                    }
                }
            } else if (sType === 'capital_initial') {
                const confSnap = await getDoc(doc(db, 'settings', 'config'));
                const conf = confSnap.exists() ? confSnap.data() : {};
                setCapMontant(conf.capitalInitial ? String(conf.capitalInitial) : (ecData?.mouvements?.[0]?.debit ? String(ecData.mouvements[0].debit) : '1000'));
                setCapDate(conf.dateCreation || (ecData?.date?.toDate ? ecData.date.toDate().toISOString().split('T')[0] : '2026-01-01'));
                setCapBanque(conf.banqueDepot || 'Banque');
            } else if (sType === 'facture' || sType === 'facturation') {
                let fData = null;
                if (sId) {
                    let fSnap = await getDoc(doc(db, 'factures', sId));
                    if (!fSnap.exists()) fSnap = await getDoc(doc(db, 'facturations', sId));
                    if (fSnap.exists()) fData = { id: fSnap.id, ...fSnap.data() };
                } else if (ecData?.id) {
                    const qF1 = query(collection(db, 'facturations'), where('ecritureFactId', '==', ecData.id));
                    let qS1 = await getDocs(qF1);
                    if (qS1.empty) {
                        const qF2 = query(collection(db, 'facturations'), where('ecriturePaiementId', '==', ecData.id));
                        qS1 = await getDocs(qF2);
                    }
                    if (!qS1.empty) {
                        fData = { id: qS1.docs[0].id, ...qS1.docs[0].data() };
                        setActualSourceId(fData.id);
                    }
                }
                if (fData) {
                    setSourceData(fData);
                    setFacClientId(fData.clientId || '');
                    setFacClientNom(fData.clientNom || '');
                    const rawDate = fData.date?.toDate ? fData.date.toDate() : new Date(fData.date || fData.dateFacturation || Date.now());
                    setFacDate(!isNaN(rawDate) ? rawDate.toISOString().split('T')[0] : '');
                    setFacDescription(fData.description || fData.lignes?.map((l) => l.description).join(', ') || '');
                    setFacMontantHT(fData.totalHT ? String(fData.totalHT) : String(fData.totalFacture || fData.totalTTC || ''));
                    setFacTvaOn(!!fData.tvaActive);
                    setFacTauxTVA(fData.tauxTVA || 20);
                    setFacStatut(fData.statut || 'encaissee');
                    const rawPay = fData.datePaiement?.toDate ? fData.datePaiement.toDate() : (fData.datePaiementStr ? new Date(fData.datePaiementStr) : null);
                    setFacDatePaiement(rawPay && !isNaN(rawPay) ? rawPay.toISOString().split('T')[0] : '');
                    const rawVir = fData.dateVirementStripe?.toDate ? fData.dateVirementStripe.toDate() : (fData.dateVirementStripeStr ? new Date(fData.dateVirementStripeStr) : null);
                    setFacDateVirementStripe(rawVir && !isNaN(rawVir) ? rawVir.toISOString().split('T')[0] : '');
                    setDocumentIds(fData.documentIds || []);
                }
            } else {
                // Écriture générale
                if (ecData) {
                    const ecDate = ecData.date?.toDate ? ecData.date.toDate() : new Date(ecData.date || Date.now());
                    setGenDate(!isNaN(ecDate) ? ecDate.toISOString().split('T')[0] : '');
                    setGenLibelle(ecData.libelle || '');
                    setGenPieceRef(ecData.pieceRef || '');
                    setGenMouvements(ecData.mouvements || []);
                }
            }

            // Charger les documents existants associés
            const docIdsToFetch = new Set(sourceData?.documentIds || []);
            if (sId) {
                const qDoc = query(collection(db, 'documents'), where('sourceId', '==', sId));
                const dSnap = await getDocs(qDoc);
                dSnap.forEach((d) => docIdsToFetch.add(d.id));
            }
            if (ecritureId) {
                const qDoc2 = query(collection(db, 'documents'), where('sourceId', '==', ecritureId));
                const dSnap2 = await getDocs(qDoc2);
                dSnap2.forEach((d) => docIdsToFetch.add(d.id));
            }

            const loadedDocs = [];
            for (const dId of docIdsToFetch) {
                try {
                    const snap = await getDoc(doc(db, 'documents', dId));
                    if (snap.exists()) loadedDocs.push({ id: snap.id, ...snap.data() });
                } catch (e) { }
            }
            setExistingDocs(loadedDocs);
        } catch (err) {
            console.error('Erreur chargement opération :', err);
            setError('Impossible de charger les données de cette opération : ' + err.message);
        } finally {
            setLoading(false);
        }
    }, [ecritureId, sourceId, sourceType, actualSourceId, operationType]);

    useEffect(() => {
        loadOperation();
    }, [loadOperation]);

    // ─── Enregistrement des modifications ───
    async function handleSave(e) {
        e.preventDefault();
        setSaving(true);
        setError('');
        setSuccessMsg('');

        try {
            if (operationType === 'depense') {
                const montantNum = parseFloat(depMontant);
                if (isNaN(montantNum) || montantNum <= 0) {
                    throw new Error('Veuillez saisir un montant valide supérieur à 0.');
                }
                if (!depDate) throw new Error('La date de la dépense est requise.');
                if (!depFournisseurNom.trim()) throw new Error('Le fournisseur est requis.');

                const categorie = CATEGORIES_DEPENSES.find((c) => c.id === depCategorieId) || CATEGORIES_DEPENSES[0];
                const actLabel = depActivite === 'site-chateau' ? 'site-chateau.fr' : depActivite === 'commun' ? 'Commun' : 'Wheeloh';
                const libelleDepense = `[${actLabel}] ${categorie.label} — ${depDescription.trim() || depFournisseurNom.trim()}`;

                const montantHT = depTvaOn ? +(montantNum / (1 + depTauxTVA / 100)).toFixed(2) : montantNum;
                const montantTVA = depTvaOn ? +(montantNum - montantHT).toFixed(2) : 0;

                // 1. Mouvements d'achat (journal AC)
                const mvtsAchat = depTvaOn
                    ? [
                        { compte: categorie.compte, libelle: `Charge — ${depFournisseurNom.trim()}`, debit: montantHT, credit: 0 },
                        { compte: '44566', libelle: `TVA déductible (${depTauxTVA}%)`, debit: montantTVA, credit: 0 },
                        { compte: '401', libelle: depFournisseurNom.trim(), debit: 0, credit: montantNum },
                    ]
                    : [
                        { compte: categorie.compte, libelle: `Charge — ${depFournisseurNom.trim()}`, debit: montantNum, credit: 0 },
                        { compte: '401', libelle: depFournisseurNom.trim(), debit: 0, credit: montantNum },
                    ];

                let targetDepId = actualSourceId;
                let ecDepId = activeEcriture?.id || sourceData?.ecritureDepenseIds?.[0] || null;

                // Si pas d'écriture AC trouvée, on en crée une
                if (!ecDepId) {
                    const newEcSnap = await addDoc(collection(db, 'ecritures'), {
                        journal: 'AC',
                        date: new Date(depDate),
                        libelle: libelleDepense,
                        pieceRef: 'FAC-' + Date.now().toString().slice(-4),
                        sourceType: 'depense',
                        sourceId: targetDepId || null,
                        mouvements: mvtsAchat,
                        statut: 'active',
                        createdAt: serverTimestamp(),
                        updatedAt: serverTimestamp(),
                    });
                    ecDepId = newEcSnap.id;
                } else {
                    // Mise à jour de l'écriture AC
                    await updateDoc(doc(db, 'ecritures', ecDepId), {
                        date: new Date(depDate),
                        libelle: libelleDepense,
                        mouvements: mvtsAchat,
                        sourceType: 'depense',
                        sourceId: targetDepId || null,
                        updatedAt: serverTimestamp(),
                    });
                }

                // 2. Gestion du paiement (journal BQ)
                const ecPaiementIds = [...(sourceData?.ecriturePaiementIds || [])];
                if (depDejaPayee) {
                    const datePaye = depDatePaiement || depDate;
                    const mvtsPaiement = [
                        { compte: '401', libelle: depFournisseurNom.trim(), debit: montantNum, credit: 0 },
                        { compte: '512', libelle: 'Banque', debit: 0, credit: montantNum },
                    ];

                    if (ecPaiementIds.length > 0) {
                        await updateDoc(doc(db, 'ecritures', ecPaiementIds[0]), {
                            date: new Date(datePaye),
                            libelle: `Paiement [${actLabel}] ${categorie.label} — ${depFournisseurNom.trim()}`,
                            mouvements: mvtsPaiement,
                            updatedAt: serverTimestamp(),
                        });
                    } else {
                        const newEcPay = await addDoc(collection(db, 'ecritures'), {
                            journal: 'BQ',
                            date: new Date(datePaye),
                            libelle: `Paiement [${actLabel}] ${categorie.label} — ${depFournisseurNom.trim()}`,
                            pieceRef: 'PAI-' + Date.now().toString().slice(-4),
                            sourceType: 'depense',
                            sourceId: targetDepId || null,
                            mouvements: mvtsPaiement,
                            statut: 'active',
                            createdAt: serverTimestamp(),
                            updatedAt: serverTimestamp(),
                        });
                        ecPaiementIds.push(newEcPay.id);
                    }
                } else if (ecPaiementIds.length > 0) {
                    // Marqué comme non payé : annuler l'écriture de paiement
                    for (const pId of ecPaiementIds) {
                        await updateDoc(doc(db, 'ecritures', pId), { statut: 'annulee', updatedAt: serverTimestamp() });
                    }
                }

                // 3. Mise à jour de la dépense dans Firestore
                const depPayload = {
                    fournisseurNom: depFournisseurNom.trim(),
                    description: depDescription.trim(),
                    montant: montantNum,
                    activite: depActivite,
                    activiteLabel: actLabel,
                    categorieId: depCategorieId,
                    categorieLabel: categorie.label,
                    categorieCompte: categorie.compte,
                    motif: depMotif.trim() || null,
                    dateDépense: new Date(depDate),
                    statut: depDejaPayee ? 'payee' : 'a_payer',
                    datePaiement: depDejaPayee ? new Date(depDatePaiement || depDate) : null,
                    tvaDéductible: depTvaOn,
                    tauxTVA: depTvaOn ? depTauxTVA : null,
                    montantHT: depTvaOn ? montantHT : null,
                    montantTVA: depTvaOn ? montantTVA : null,
                    ecritureDepenseIds: [ecDepId],
                    ecriturePaiementIds: depDejaPayee ? ecPaiementIds : [],
                    documentIds,
                    updatedAt: serverTimestamp(),
                };

                if (targetDepId) {
                    await updateDoc(doc(db, 'depenses', targetDepId), depPayload);
                } else {
                    const newDepRef = await addDoc(collection(db, 'depenses'), {
                        ...depPayload,
                        createdAt: serverTimestamp(),
                    });
                    targetDepId = newDepRef.id;
                    await updateDoc(doc(db, 'ecritures', ecDepId), { sourceId: targetDepId });
                }

                // Lier les justificatifs à la dépense
                for (const dId of documentIds) {
                    await updateDoc(doc(db, 'documents', dId), { sourceId: targetDepId, sourceType: 'depense' });
                }

                invalidateCache('depenses');
                setSuccessMsg('Dépense et écritures comptables mises à jour avec succès.');
            } else if (operationType === 'cca') {
                const montantNum = parseFloat(ccaMontant);
                if (isNaN(montantNum) || montantNum <= 0) throw new Error('Montant CCA invalide.');
                if (!ccaDate) throw new Error('Date requise.');
                if (!ccaAssocieId) throw new Error('Veuillez sélectionner un associé.');

                const ass = associes.find((a) => a.id === ccaAssocieId);
                const nomAss = ass ? `${ass.nom} ${ass.prenom || ''}`.trim() : 'Associé';
                const compteCC = ass?.compteCC || '455';

                const mvts = ccaType === 'apport'
                    ? [
                        { compte: '512', libelle: `Banque — Apport ${nomAss}`, debit: montantNum, credit: 0 },
                        { compte: compteCC, libelle: `Compte courant ${nomAss}`, debit: 0, credit: montantNum },
                    ]
                    : [
                        { compte: compteCC, libelle: `Compte courant ${nomAss}`, debit: montantNum, credit: 0 },
                        { compte: '512', libelle: `Banque — Remboursement ${nomAss}`, debit: 0, credit: montantNum },
                    ];

                let targetCcaId = actualSourceId;
                let ecId = activeEcriture?.id || sourceData?.ecritureId || null;

                const libelleCca = `${ccaType === 'apport' ? 'Apport' : 'Remboursement'} CCA — ${nomAss} — ${ccaDescription.trim()}`;

                if (ecId) {
                    await updateDoc(doc(db, 'ecritures', ecId), {
                        date: new Date(ccaDate),
                        libelle: libelleCca,
                        mouvements: mvts,
                        sourceType: `cca_${ccaType}`,
                        sourceId: targetCcaId || null,
                        updatedAt: serverTimestamp(),
                    });
                } else {
                    const newEcSnap = await addDoc(collection(db, 'ecritures'), {
                        journal: 'BQ',
                        date: new Date(ccaDate),
                        libelle: libelleCca,
                        pieceRef: 'CCA-' + Date.now().toString().slice(-4),
                        sourceType: `cca_${ccaType}`,
                        sourceId: targetCcaId || null,
                        mouvements: mvts,
                        statut: 'active',
                        createdAt: serverTimestamp(),
                        updatedAt: serverTimestamp(),
                    });
                    ecId = newEcSnap.id;
                }

                const ccaPayload = {
                    associeId: ccaAssocieId,
                    associeNom: nomAss,
                    type: ccaType,
                    montant: montantNum,
                    dateMouvement: new Date(ccaDate),
                    description: ccaDescription.trim(),
                    taux: ccaTaux ? parseFloat(ccaTaux) : null,
                    documentIds,
                    ecritureId: ecId,
                    updatedAt: serverTimestamp(),
                };

                if (targetCcaId) {
                    await updateDoc(doc(db, 'ccaMouvements', targetCcaId), ccaPayload);
                } else {
                    const newCcaRef = await addDoc(collection(db, 'ccaMouvements'), {
                        ...ccaPayload,
                        createdAt: serverTimestamp(),
                    });
                    targetCcaId = newCcaRef.id;
                    await updateDoc(doc(db, 'ecritures', ecId), { sourceId: targetCcaId });
                }

                invalidateCache('ccaMouvements');
                setSuccessMsg('Mouvement CCA et écriture comptable mis à jour.');
            } else if (operationType === 'capital_initial') {
                const montantNum = parseFloat(capMontant);
                if (isNaN(montantNum) || montantNum <= 0) throw new Error('Montant de capital invalide.');
                if (!capDate) throw new Error('Date de création requise.');

                const libelleCap = `Dépôt du capital social initial — ${capBanque.trim() || 'Banque'}`;
                const mvts = [
                    { compte: '512', libelle: `Banque — Dépôt capital initial (${capBanque.trim() || 'Banque'})`, debit: montantNum, credit: 0 },
                    { compte: '101', libelle: 'Capital social souscrit et libéré', debit: 0, credit: montantNum },
                ];

                let ecId = activeEcriture?.id;
                if (!ecId) {
                    const confSnap = await getDoc(doc(db, 'settings', 'config'));
                    if (confSnap.exists()) ecId = confSnap.data()?.ecritureCapitalInitialId;
                }

                if (ecId) {
                    await updateDoc(doc(db, 'ecritures', ecId), {
                        date: new Date(capDate),
                        libelle: libelleCap,
                        pieceRef: 'STATUTS',
                        mouvements: mvts,
                        updatedAt: serverTimestamp(),
                    });
                } else {
                    const res = await addDoc(collection(db, 'ecritures'), {
                        journal: 'BQ',
                        date: new Date(capDate),
                        libelle: libelleCap,
                        sourceType: 'capital_initial',
                        pieceRef: 'STATUTS',
                        mouvements: mvts,
                        statut: 'active',
                        createdAt: serverTimestamp(),
                        updatedAt: serverTimestamp(),
                    });
                    ecId = res.id;
                }

                await updateDoc(doc(db, 'settings', 'config'), {
                    capitalInitial: montantNum,
                    dateCreation: capDate,
                    banqueDepot: capBanque.trim(),
                    ecritureCapitalInitialId: ecId,
                    updatedAt: serverTimestamp(),
                });

                setSuccessMsg('Capital social et date initiale mis à jour avec succès.');
            } else if (operationType === 'facture') {
                const montantHTNum = parseFloat(facMontantHT);
                if (isNaN(montantHTNum) || montantHTNum <= 0) throw new Error('Montant de facture invalide.');
                if (!facDate) throw new Error('Date de facture requise.');

                const { ht, tva, ttc } = facTvaOn
                    ? calculerTTCdepuisHT(montantHTNum, facTauxTVA)
                    : { ht: montantHTNum, tva: 0, ttc: montantHTNum };

                const clientObj = clients.find((c) => c.id === facClientId);
                const nomClientFinal = clientObj ? clientObj.nom : (facClientNom.trim() || 'Client');
                const libelleFact = `Facturation — ${nomClientFinal} — ${facDescription.trim() || 'Prestation'}`;

                const mvtsVente = facTvaOn && tva > 0
                    ? [
                        { compte: '411', libelle: `Client ${nomClientFinal}`, debit: ttc, credit: 0 },
                        { compte: '706', libelle: 'Prestations de services', debit: 0, credit: ht },
                        { compte: '44571', libelle: `TVA collectée (${facTauxTVA}%)`, debit: 0, credit: tva },
                    ]
                    : [
                        { compte: '411', libelle: `Client ${nomClientFinal}`, debit: ttc, credit: 0 },
                        { compte: '706', libelle: 'Prestations de services', debit: 0, credit: ttc },
                    ];

                let ecId = activeEcriture?.id;
                let targetFactId = actualSourceId;

                const ecFactId = sourceData?.ecritureFactId || (activeEcriture?.journal !== 'BQ' ? ecId : null);
                const ecPaiementId = sourceData?.ecriturePaiementId || (activeEcriture?.journal === 'BQ' ? ecId : null);

                if (ecFactId) {
                    await updateDoc(doc(db, 'ecritures', ecFactId), {
                        date: new Date(facDate),
                        libelle: libelleFact,
                        mouvements: mvtsVente,
                        sourceId: targetFactId || null,
                        sourceType: 'facturation',
                        updatedAt: serverTimestamp(),
                    });
                } else if (ecId && activeEcriture?.journal !== 'BQ') {
                    await updateDoc(doc(db, 'ecritures', ecId), {
                        date: new Date(facDate),
                        libelle: libelleFact,
                        mouvements: mvtsVente,
                        sourceId: targetFactId || null,
                        sourceType: 'facturation',
                        updatedAt: serverTimestamp(),
                    });
                }

                // Synchronisation de la date d'encaissement / virement bancaire Stripe sur l'écriture BQ
                if (ecPaiementId) {
                    const paymentDate = facDateVirementStripe || facDatePaiement;
                    if (paymentDate) {
                        await updateDoc(doc(db, 'ecritures', ecPaiementId), {
                            date: new Date(paymentDate),
                            updatedAt: serverTimestamp(),
                        });
                    }
                }

                const factPayload = {
                    clientId: facClientId || null,
                    clientNom: nomClientFinal,
                    date: new Date(facDate),
                    dateFacturation: facDate,
                    description: facDescription.trim(),
                    totalHT: ht,
                    totalTVA: tva,
                    totalTTC: ttc,
                    totalFacture: ttc,
                    tvaActive: facTvaOn,
                    tauxTVA: facTvaOn ? facTauxTVA : null,
                    statut: facStatut,
                    datePaiement: facDatePaiement ? new Date(facDatePaiement) : null,
                    datePaiementStr: facDatePaiement || null,
                    dateVirementStripe: facDateVirementStripe ? new Date(facDateVirementStripe) : null,
                    dateVirementStripeStr: facDateVirementStripe || null,
                    documentIds,
                    updatedAt: serverTimestamp(),
                };

                if (targetFactId) {
                    const ref1 = doc(db, 'facturations', targetFactId);
                    const s1 = await getDoc(ref1);
                    if (s1.exists()) {
                        await updateDoc(ref1, factPayload);
                    } else {
                        await updateDoc(doc(db, 'factures', targetFactId), factPayload);
                    }
                }

                for (const dId of documentIds) {
                    try {
                        await updateDoc(doc(db, 'documents', dId), { sourceId: targetFactId || ecId });
                    } catch (e) {
                        console.warn('Liaison document ignoree:', e);
                    }
                }

                invalidateCache('factures');
                invalidateCache('facturations');
                invalidateEcrituresCache();
                setSuccessMsg('Facturation et écritures comptables mises à jour avec succès.');
            } else if (operationType === 'od' || !sourceData) {
                // Écriture générale modifiée directement
                if (!activeEcriture?.id) throw new Error('Aucune écriture sélectionnée.');
                const dTot = genMouvements.reduce((s, m) => s + (parseFloat(m.debit) || 0), 0);
                const cTot = genMouvements.reduce((s, m) => s + (parseFloat(m.credit) || 0), 0);

                if (Math.abs(dTot - cTot) > 0.01) {
                    throw new Error(`L'écriture n'est pas équilibrée : Total Débit = ${formatMontant(dTot)} vs Total Crédit = ${formatMontant(cTot)}.`);
                }

                await updateDoc(doc(db, 'ecritures', activeEcriture.id), {
                    date: new Date(genDate),
                    libelle: genLibelle.trim(),
                    pieceRef: genPieceRef.trim(),
                    mouvements: genMouvements.map((m) => ({
                        ...m,
                        debit: parseFloat(m.debit) || 0,
                        credit: parseFloat(m.credit) || 0,
                    })),
                    updatedAt: serverTimestamp(),
                });
                setSuccessMsg('Écriture comptable mise à jour avec succès.');
            }

            invalidateEcrituresCache();
            setTimeout(() => {
                onSaved?.();
                onClose?.();
            }, 700);
        } catch (err) {
            console.error('Erreur sauvegarde opération :', err);
            setError(err.message || 'Erreur lors de la sauvegarde.');
        } finally {
            setSaving(false);
        }
    }

    // ─── Suppression complète de l'opération ───
    async function handleDeleteOperation() {
        const msg = `Êtes-vous absolument certain de vouloir supprimer cette opération ?\n\nCette action supprimera également l'écriture comptable correspondante du Grand Livre et de tous les états financiers.`;
        if (!window.confirm(msg)) return;

        setSaving(true);
        setError('');
        try {
            // 1. Supprimer le document source si existant
            if (operationType === 'depense' && actualSourceId) {
                await deleteDoc(doc(db, 'depenses', actualSourceId));
                invalidateCache('depenses');
            } else if (operationType === 'cca' && actualSourceId) {
                await deleteDoc(doc(db, 'ccaMouvements', actualSourceId));
                invalidateCache('ccaMouvements');
            } else if (operationType === 'facture' && actualSourceId) {
                await deleteDoc(doc(db, 'factures', actualSourceId));
                invalidateCache('factures');
            }

            // 2. Supprimer ou marquer annulées les écritures comptables
            const ecrituresToDelete = new Set();
            if (activeEcriture?.id) ecrituresToDelete.add(activeEcriture.id);
            if (sourceData?.ecritureDepenseIds) sourceData.ecritureDepenseIds.forEach((id) => ecrituresToDelete.add(id));
            if (sourceData?.ecriturePaiementIds) sourceData.ecriturePaiementIds.forEach((id) => ecrituresToDelete.add(id));
            if (sourceData?.ecritureId) ecrituresToDelete.add(sourceData.ecritureId);

            for (const eId of ecrituresToDelete) {
                try {
                    await deleteDoc(doc(db, 'ecritures', eId));
                } catch (e) {
                    // Si la suppression physique échoue, passer en statut annulée
                    await updateDoc(doc(db, 'ecritures', eId), { statut: 'annulee', updatedAt: serverTimestamp() });
                }
            }

            invalidateEcrituresCache();
            setSuccessMsg('Opération et écritures comptables supprimées avec succès.');
            setTimeout(() => {
                onSaved?.();
                onClose?.();
            }, 600);
        } catch (err) {
            console.error('Erreur suppression :', err);
            setError('Erreur lors de la suppression : ' + err.message);
            setSaving(false);
        }
    }

    return (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.65)',
                backdropFilter: 'blur(3px)',
                zIndex: 999,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 16,
            }}
            onClick={onClose}
        >
            <div
                style={{
                    backgroundColor: 'var(--bg)',
                    borderRadius: 12,
                    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.25)',
                    border: '1px solid var(--border)',
                    width: '100%',
                    maxWidth: 780,
                    maxHeight: '92vh',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* ─── En-tête Modal ─── */}
                <div
                    style={{
                        padding: '16px 20px',
                        borderBottom: '1px solid var(--border)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        background: 'var(--bg2)',
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div>
                            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text)' }}>
                                Modifier l'opération :{' '}
                                {operationType === 'depense'
                                    ? 'Dépense d\'exploitation'
                                    : operationType === 'cca'
                                        ? 'Mouvement de Compte Courant d\'Associé (CCA)'
                                        : operationType === 'capital_initial'
                                            ? 'Dépôt du Capital Social Initial'
                                            : operationType === 'facture'
                                                ? 'Facture client'
                                                : 'Écriture comptable'}
                            </h2>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                                {ecritureId ? `Réf. Écriture : ${ecritureId}` : `Réf. Document : ${actualSourceId || 'Nouveau'}`}
                            </div>
                        </div>
                    </div>

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
                        }}
                    >
                        ✕
                    </button>
                </div>

                {/* ─── Corps défilable ─── */}
                <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
                    {loading ? (
                        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                            Chargement des informations de l'opération...
                        </div>
                    ) : (
                        <form onSubmit={handleSave}>
                            {error && <div className="notice notice--danger" style={{ marginBottom: 16 }}>{error}</div>}
                            {successMsg && <div className="notice notice--success" style={{ marginBottom: 16 }}>{successMsg}</div>}

                            {/* ─── FORMULAIRE DÉPENSE ─── */}
                            {operationType === 'depense' && (
                                <div>
                                    {/* Sélecteur d'Activité */}
                                    <div className="card" style={{ marginBottom: 16, background: 'var(--bg2)', padding: '12px 16px' }}>
                                        <label className="form-label" style={{ marginBottom: 8, fontWeight: 600 }}>
                                            Activité analytique concernée :
                                        </label>
                                        <div style={{ display: 'flex', gap: 10 }}>
                                            <button
                                                type="button"
                                                className={`btn ${depActivite === 'wheeloh' ? 'btn--primary' : 'btn--ghost'}`}
                                                style={{ flex: 1 }}
                                                onClick={() => setDepActivite('wheeloh')}
                                            >
                                                Wheeloh
                                            </button>
                                            <button
                                                type="button"
                                                className={`btn ${depActivite === 'site-chateau' ? 'btn--primary' : 'btn--ghost'}`}
                                                style={{ flex: 1 }}
                                                onClick={() => setDepActivite('site-chateau')}
                                            >
                                                site-chateau.fr
                                            </button>
                                            <button
                                                type="button"
                                                className={`btn ${depActivite === 'commun' ? 'btn--primary' : 'btn--ghost'}`}
                                                style={{ flex: 1 }}
                                                onClick={() => setDepActivite('commun')}
                                            >
                                                Commun (Structure)
                                            </button>
                                        </div>
                                    </div>

                                    {/* Date, Montant, Fournisseur */}
                                    <div className="form-row--3">
                                        <div className="form-group">
                                            <label className="form-label">Date de la dépense *</label>
                                            <input
                                                type="date"
                                                className="form-input"
                                                value={depDate}
                                                onChange={(e) => setDepDate(e.target.value)}
                                                required
                                            />
                                        </div>

                                        <div className="form-group">
                                            <label className="form-label">Montant TTC (€) *</label>
                                            <input
                                                type="number"
                                                step="0.01"
                                                className="form-input"
                                                value={depMontant}
                                                onChange={(e) => setDepMontant(e.target.value)}
                                                required
                                            />
                                        </div>

                                        <div className="form-group">
                                            <label className="form-label">Fournisseur *</label>
                                            <input
                                                type="text"
                                                className="form-input"
                                                value={depFournisseurNom}
                                                onChange={(e) => setDepFournisseurNom(e.target.value)}
                                                placeholder="Ex. OVH, Adobe, Google, SNCF..."
                                                required
                                            />
                                        </div>
                                    </div>

                                    {/* Catégorie de charge comptable */}
                                    <div className="form-group">
                                        <label className="form-label">Catégorie comptable (Plan Comptable Général)</label>
                                        <select
                                            className="form-select"
                                            value={depCategorieId}
                                            onChange={(e) => setDepCategorieId(e.target.value)}
                                        >
                                            {CATEGORIES_DEPENSES.map((c) => (
                                                <option key={c.id} value={c.id}>
                                                    {c.label} (Compte {c.compte})
                                                </option>
                                            ))}
                                        </select>
                                    </div>

                                    {/* Description & Motif */}
                                    <div className="form-row--2">
                                        <div className="form-group">
                                            <label className="form-label">Description de la dépense</label>
                                            <input
                                                type="text"
                                                className="form-input"
                                                value={depDescription}
                                                onChange={(e) => setDepDescription(e.target.value)}
                                                placeholder="Ex. Abonnement serveur mensuel"
                                            />
                                        </div>

                                        <div className="form-group">
                                            <label className="form-label">Motif professionnel / Justification fiscale</label>
                                            <input
                                                type="text"
                                                className="form-input"
                                                value={depMotif}
                                                onChange={(e) => setDepMotif(e.target.value)}
                                                placeholder="Ex. Hébergement infrastructure web"
                                            />
                                        </div>
                                    </div>

                                    {/* TVA & Paiement */}
                                    <div className="card" style={{ padding: '14px 18px', background: 'var(--bg2)', marginBottom: 16 }}>
                                        <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={depTvaOn}
                                                    onChange={(e) => setDepTvaOn(e.target.checked)}
                                                />
                                                <span style={{ fontWeight: 600 }}>TVA Déductible</span>
                                            </label>

                                            {depTvaOn && (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                    <span style={{ fontSize: 13 }}>Taux TVA :</span>
                                                    <select
                                                        className="form-select"
                                                        style={{ width: 100, padding: '4px 8px' }}
                                                        value={depTauxTVA}
                                                        onChange={(e) => setDepTauxTVA(Number(e.target.value))}
                                                    >
                                                        <option value={20}>20 %</option>
                                                        <option value={10}>10 %</option>
                                                        <option value={5.5}>5.5 %</option>
                                                        <option value={8.5}>8.5 %</option>
                                                    </select>
                                                </div>
                                            )}

                                            <div style={{ borderLeft: '1px solid var(--border)', height: 24, margin: '0 4px' }} />

                                            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={depDejaPayee}
                                                    onChange={(e) => setDepDejaPayee(e.target.checked)}
                                                />
                                                <span style={{ fontWeight: 600 }}>Déjà payée</span>
                                            </label>

                                            {depDejaPayee && (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                    <span style={{ fontSize: 13 }}>Date paiement :</span>
                                                    <input
                                                        type="date"
                                                        className="form-input"
                                                        style={{ width: 150, padding: '4px 8px' }}
                                                        value={depDatePaiement}
                                                        onChange={(e) => setDepDatePaiement(e.target.value)}
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* ─── FORMULAIRE CCA ─── */}
                            {operationType === 'cca' && (
                                <div>
                                    <div className="form-row--3">
                                        <div className="form-group">
                                            <label className="form-label">Associé concerné *</label>
                                            <select
                                                className="form-select"
                                                value={ccaAssocieId}
                                                onChange={(e) => setCcaAssocieId(e.target.value)}
                                                required
                                            >
                                                <option value="">Sélectionner un associé</option>
                                                {associes.map((a) => (
                                                    <option key={a.id} value={a.id}>
                                                        {a.nom} {a.prenom || ''} (Compte {a.compteCC || '455'})
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        <div className="form-group">
                                            <label className="form-label">Type d'opération *</label>
                                            <select
                                                className="form-select"
                                                value={ccaType}
                                                onChange={(e) => setCcaType(e.target.value)}
                                            >
                                                <option value="apport">Apport en CCA (Prêt de l'associé)</option>
                                                <option value="remboursement">Remboursement de CCA (Société rembourse)</option>
                                            </select>
                                        </div>

                                        <div className="form-group">
                                            <label className="form-label">Montant (€) *</label>
                                            <input
                                                type="number"
                                                step="0.01"
                                                className="form-input"
                                                value={ccaMontant}
                                                onChange={(e) => setCcaMontant(e.target.value)}
                                                required
                                            />
                                        </div>
                                    </div>

                                    <div className="form-row--2">
                                        <div className="form-group">
                                            <label className="form-label">Date réelle de l'opération *</label>
                                            <input
                                                type="date"
                                                className="form-input"
                                                value={ccaDate}
                                                onChange={(e) => setCcaDate(e.target.value)}
                                                required
                                            />
                                        </div>

                                        <div className="form-group">
                                            <label className="form-label">Taux d'intérêt conventionnel (%)</label>
                                            <input
                                                type="number"
                                                step="0.01"
                                                className="form-input"
                                                value={ccaTaux}
                                                onChange={(e) => setCcaTaux(e.target.value)}
                                                placeholder="Ex. 5.00"
                                            />
                                        </div>
                                    </div>

                                    <div className="form-group">
                                        <label className="form-label">Description / Motif *</label>
                                        <input
                                            type="text"
                                            className="form-input"
                                            value={ccaDescription}
                                            onChange={(e) => setCcaDescription(e.target.value)}
                                            placeholder="Ex. Virement apport trésorerie pour achat matériel"
                                            required
                                        />
                                    </div>
                                </div>
                            )}

                            {/* ─── FORMULAIRE CAPITAL INITIAL ─── */}
                            {operationType === 'capital_initial' && (
                                <div>
                                    <div className="form-row--3">
                                        <div className="form-group">
                                            <label className="form-label">Montant du capital initial (€) *</label>
                                            <input
                                                type="number"
                                                step="0.01"
                                                className="form-input"
                                                value={capMontant}
                                                onChange={(e) => setCapMontant(e.target.value)}
                                                required
                                            />
                                        </div>

                                        <div className="form-group">
                                            <label className="form-label">Date de libération / création *</label>
                                            <input
                                                type="date"
                                                className="form-input"
                                                value={capDate}
                                                onChange={(e) => setCapDate(e.target.value)}
                                                required
                                            />
                                        </div>

                                        <div className="form-group">
                                            <label className="form-label">Banque dépositaire des fonds</label>
                                            <input
                                                type="text"
                                                className="form-input"
                                                value={capBanque}
                                                onChange={(e) => setCapBanque(e.target.value)}
                                                placeholder="Ex. Qonto, Shine, BNP..."
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* ─── FORMULAIRE FACTURE / FACTURATION CLIENT ─── */}
                            {operationType === 'facture' && (
                                <div>
                                    <div className="form-row--2">
                                        <div className="form-group">
                                            <label className="form-label">Client</label>
                                            <input
                                                type="text"
                                                className="form-input"
                                                value={facClientNom}
                                                onChange={(e) => setFacClientNom(e.target.value)}
                                                placeholder="Nom du client"
                                            />
                                        </div>

                                        <div className="form-group">
                                            <label className="form-label">Date de facturation *</label>
                                            <input
                                                type="date"
                                                className="form-input"
                                                value={facDate}
                                                onChange={(e) => setFacDate(e.target.value)}
                                                required
                                            />
                                        </div>
                                    </div>

                                    <div className="form-group">
                                        <label className="form-label">Description / Prestation *</label>
                                        <input
                                            type="text"
                                            className="form-input"
                                            value={facDescription}
                                            onChange={(e) => setFacDescription(e.target.value)}
                                            placeholder="Ex. Création site internet, Maintenance..."
                                            required
                                        />
                                    </div>

                                    <div className="form-row--3">
                                        <div className="form-group">
                                            <label className="form-label">Montant HT (€) *</label>
                                            <input
                                                type="number"
                                                step="0.01"
                                                className="form-input"
                                                value={facMontantHT}
                                                onChange={(e) => setFacMontantHT(e.target.value)}
                                                required
                                            />
                                        </div>

                                        <div className="form-group">
                                            <label className="form-label">Date du paiement client</label>
                                            <input
                                                type="date"
                                                className="form-input"
                                                value={facDatePaiement}
                                                onChange={(e) => setFacDatePaiement(e.target.value)}
                                            />
                                            <span className="form-hint">Date de règlement par le client.</span>
                                        </div>

                                        <div className="form-group">
                                            <label className="form-label">Date du virement Stripe vers mon compte</label>
                                            <input
                                                type="date"
                                                className="form-input"
                                                value={facDateVirementStripe}
                                                onChange={(e) => setFacDateVirementStripe(e.target.value)}
                                            />
                                            <span className="form-hint">Date d'apparition sur le relevé bancaire (compte 512).</span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* ─── FORMULAIRE ÉCRITURE GÉNÉRALE (OD / autre) ─── */}
                            {(operationType === 'od' || operationType === 'autre') && (
                                <div>
                                    <div className="form-row--2">
                                        <div className="form-group">
                                            <label className="form-label">Date de l'écriture *</label>
                                            <input
                                                type="date"
                                                className="form-input"
                                                value={genDate}
                                                onChange={(e) => setGenDate(e.target.value)}
                                                required
                                            />
                                        </div>

                                        <div className="form-group">
                                            <label className="form-label">Pièce de référence</label>
                                            <input
                                                type="text"
                                                className="form-input"
                                                value={genPieceRef}
                                                onChange={(e) => setGenPieceRef(e.target.value)}
                                            />
                                        </div>
                                    </div>

                                    <div className="form-group">
                                        <label className="form-label">Libellé général de l'écriture *</label>
                                        <input
                                            type="text"
                                            className="form-input"
                                            value={genLibelle}
                                            onChange={(e) => setGenLibelle(e.target.value)}
                                            required
                                        />
                                    </div>

                                    {/* Mouvements partie double */}
                                    <div className="table-wrap" style={{ marginTop: 12, marginBottom: 16 }}>
                                        <table>
                                            <thead>
                                                <tr>
                                                    <th style={{ width: 90 }}>Compte</th>
                                                    <th>Libellé de la ligne</th>
                                                    <th style={{ width: 110, textAlign: 'right' }}>Débit</th>
                                                    <th style={{ width: 110, textAlign: 'right' }}>Crédit</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {genMouvements.map((m, idx) => (
                                                    <tr key={idx}>
                                                        <td>
                                                            <input
                                                                type="text"
                                                                className="form-input"
                                                                style={{ padding: '4px 6px', fontSize: 12 }}
                                                                value={m.compte}
                                                                onChange={(e) => {
                                                                    const val = e.target.value;
                                                                    setGenMouvements((prev) => prev.map((x, i) => i === idx ? { ...x, compte: val } : x));
                                                                }}
                                                            />
                                                        </td>
                                                        <td>
                                                            <input
                                                                type="text"
                                                                className="form-input"
                                                                style={{ padding: '4px 6px', fontSize: 12 }}
                                                                value={m.libelle}
                                                                onChange={(e) => {
                                                                    const val = e.target.value;
                                                                    setGenMouvements((prev) => prev.map((x, i) => i === idx ? { ...x, libelle: val } : x));
                                                                }}
                                                            />
                                                        </td>
                                                        <td>
                                                            <input
                                                                type="number"
                                                                step="0.01"
                                                                className="form-input"
                                                                style={{ padding: '4px 6px', fontSize: 12, textAlign: 'right' }}
                                                                value={m.debit || ''}
                                                                onChange={(e) => {
                                                                    const val = e.target.value;
                                                                    setGenMouvements((prev) => prev.map((x, i) => i === idx ? { ...x, debit: val ? parseFloat(val) : 0 } : x));
                                                                }}
                                                            />
                                                        </td>
                                                        <td>
                                                            <input
                                                                type="number"
                                                                step="0.01"
                                                                className="form-input"
                                                                style={{ padding: '4px 6px', fontSize: 12, textAlign: 'right' }}
                                                                value={m.credit || ''}
                                                                onChange={(e) => {
                                                                    const val = e.target.value;
                                                                    setGenMouvements((prev) => prev.map((x, i) => i === idx ? { ...x, credit: val ? parseFloat(val) : 0 } : x));
                                                                }}
                                                            />
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {/* ─── SECTION PIÈCES JUSTIFICATIVES & UPLOAD ─── */}
                            <div className="card" style={{ marginTop: 20, background: 'var(--bg2)', padding: '16px 20px' }}>
                                <div className="card__title" style={{ fontSize: 14, marginBottom: 12 }}>
                                    Pièces justificatives ({existingDocs.length + documentIds.length - existingDocs.filter(d => documentIds.includes(d.id)).length})
                                </div>

                                {/* Liste des justificatifs existants */}
                                {existingDocs.length > 0 && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
                                        {existingDocs.map((d) => (
                                            <div
                                                key={d.id}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'space-between',
                                                    padding: '8px 12px',
                                                    background: 'var(--bg)',
                                                    border: '1px solid var(--border)',
                                                    borderRadius: 6,
                                                }}
                                            >
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                    <span className="badge badge--muted" style={{ fontSize: 10, padding: '2px 5px' }}>
                                                        {d.type === 'pdf' ? 'PDF' : 'FICHIER'}
                                                    </span>
                                                    <span style={{ fontSize: 13, fontWeight: 600 }}>{d.nom}</span>
                                                </div>
                                                <div style={{ display: 'flex', gap: 8 }}>
                                                    {(d.downloadURL || d.dataUrl) && (
                                                        <a
                                                            href={d.downloadURL || d.dataUrl}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            download={d.nom}
                                                            className="btn btn--sm btn--ghost"
                                                            style={{ fontSize: 11, padding: '2px 8px' }}
                                                        >
                                                            Voir / Télécharger
                                                        </a>
                                                    )}
                                                    <button
                                                        type="button"
                                                        className="btn btn--sm btn--ghost"
                                                        style={{ fontSize: 11, padding: '2px 8px', color: 'var(--danger)' }}
                                                        onClick={() => {
                                                            setExistingDocs((prev) => prev.filter((x) => x.id !== d.id));
                                                            setDocumentIds((prev) => prev.filter((id) => id !== d.id));
                                                        }}
                                                    >
                                                        Détacher
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Upload nouveau fichier */}
                                <FileUpload
                                    sourceType={operationType}
                                    sourceId={actualSourceId}
                                    onUploaded={({ documentId, downloadURL, nom, type, dataUrl }) => {
                                        setDocumentIds((prev) => [...prev, documentId]);
                                        setExistingDocs((prev) => [...prev, { id: documentId, downloadURL, nom, type, dataUrl }]);
                                    }}
                                />
                            </div>

                            {/* ─── BOUTONS D'ACTION ─── */}
                            <div
                                style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    marginTop: 24,
                                    borderTop: '1px solid var(--border)',
                                    paddingTop: 16,
                                }}
                            >
                                <button
                                    type="button"
                                    className="btn btn--ghost"
                                    style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
                                    onClick={handleDeleteOperation}
                                    disabled={saving}
                                >
                                    Supprimer cette opération
                                </button>

                                <div style={{ display: 'flex', gap: 10 }}>
                                    <button
                                        type="button"
                                        className="btn btn--ghost"
                                        onClick={onClose}
                                        disabled={saving}
                                    >
                                        Annuler
                                    </button>
                                    <button
                                        type="submit"
                                        className="btn btn--primary"
                                        disabled={saving}
                                        style={{ minWidth: 160 }}
                                    >
                                        {saving ? 'Enregistrement...' : 'Enregistrer les modifications'}
                                    </button>
                                </div>
                            </div>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
}
