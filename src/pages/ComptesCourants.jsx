/**
 * ComptesCourants.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Section complète de gestion des Comptes Courants d'Associés (CCA) :
 * - Vue d'ensemble des soldes par associé
 * - Historique des mouvements (apports, remboursements, avances, intérêts)
 * - Téléversement et consultation des justificatifs
 * - Calculateur d'intérêts au prorata temporis avec contrôle du plafond fiscal
 *   (taux légal d'intérêts déductibles selon le BOFiP / CGI art. 39-1-3°)
 * - Comptabilisation automatique des opérations (512/455x et 6615/455x)
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
    collection, query, orderBy, getDocs, addDoc, doc, updateDoc, serverTimestamp, where
} from 'firebase/firestore';
import { db } from '../firebase';
import { ecrireEcriture } from '../services/api';
import { formatMontant, formatDate } from '../services/helpers';
import { FileUpload } from '../components/FileUpload';
import { Tooltip } from '../components/Shared';
import { getCached, setCached } from '../services/dataCache';

// Taux légal maximum d'intérêts déductibles pour les CCA (seuil d'alerte configuré à 4.00%)
const TAUX_LEGAL_DEFECT_2026 = 4.00;

export default function ComptesCourants() {
    const [associes, setAssocies] = useState(() => getCached('associes') || []);
    const [mouvements, setMouvements] = useState(() => getCached('ccaMouvements') || []);
    const [avances, setAvances] = useState(() => getCached('avancesFrags') || []);
    const [documents, setDocuments] = useState(() => getCached('documents') || []);
    const [loading, setLoading] = useState(() => !getCached('associes'));

    // Onglet actif
    const [activeTab, setActiveTab] = useState('synthese'); // 'synthese' | 'mouvements' | 'interets'

    // Filtre associé pour l'historique
    const [filtreAssocie, setFiltreAssocie] = useState('');

    // Modal / formulaire nouveau mouvement
    const [showFormMvt, setShowFormMvt] = useState(false);
    const [formAssocieId, setFormAssocieId] = useState('');
    const [formType, setFormType] = useState('apport'); // 'apport' | 'remboursement'
    const [formMontant, setFormMontant] = useState('');
    const [formDate, setFormDate] = useState(new Date().toISOString().split('T')[0]);
    const [formDescription, setFormDescription] = useState('');
    const [formTaux, setFormTaux] = useState('');
    const [formDocIds, setFormDocIds] = useState([]);
    const [savingMvt, setSavingMvt] = useState(false);
    const [formError, setFormError] = useState('');
    const [formSuccess, setFormSuccess] = useState('');

    // Calculateur d'intérêts
    const [calcAssocieId, setCalcAssocieId] = useState('');
    const [calcDateDebut, setCalcDateDebut] = useState(`${new Date().getFullYear()}-01-01`);
    const [calcDateFin, setCalcDateFin] = useState(new Date().toISOString().split('T')[0]);
    const [calcTaux, setCalcTaux] = useState(TAUX_LEGAL_DEFECT_2026);
    const [calcTauxLegalPlafond, setCalcTauxLegalPlafond] = useState(TAUX_LEGAL_DEFECT_2026);
    const [comptabilisationEnCours, setComptabilisationEnCours] = useState(false);
    const [calcSuccess, setCalcSuccess] = useState('');

    // Chargement des données
    const loadData = useCallback(async () => {
        if (!getCached('associes')) {
            setLoading(true);
        }
        try {
            const [assSnap, mvtSnap, avSnap, docSnap] = await Promise.all([
                getDocs(query(collection(db, 'associes'), orderBy('nom'))),
                getDocs(query(collection(db, 'ccaMouvements'), orderBy('dateMouvement', 'desc'))),
                getDocs(collection(db, 'avancesFrags')),
                getDocs(collection(db, 'documents')),
            ]);

            const assList = assSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
            const mvtList = mvtSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
            const avList = avSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
            const docList = docSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

            setAssocies(assList);
            setMouvements(mvtList);
            setAvances(avList);
            setDocuments(docList);

            setCached('associes', assList);
            setCached('ccaMouvements', mvtList);
            setCached('avancesFrags', avList);
            setCached('documents', docList);

            if (assList.length > 0 && !formAssocieId) {
                setFormAssocieId(assList[0].id);
                setCalcAssocieId(assList[0].id);
                setCalcTaux(assList[0].tauxInteretCCA ?? TAUX_LEGAL_DEFECT_2026);
            }
        } catch (e) {
            console.error('Erreur chargement CCA:', e);
        } finally {
            setLoading(false);
        }
    }, [formAssocieId]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    // Calcul des soldes CCA par associé
    // Mouvements CCA :
    // - apport : augmente le solde de la société envers l'associé (+ montant)
    // - remboursement : diminue le solde (- montant)
    // - interets : augmente le solde de l'associé (+ montant)
    // Avances de frais :
    // - statut 'a_rembourser' : + montant
    // - statut 'rembourse' : 0 (déjà remboursé)
    const statsAssocies = useMemo(() => {
        return associes.map((a) => {
            // Mouvements explicites CCA
            const mvtsA = mouvements.filter((m) => m.associeId === a.id);
            const totalApports = mvtsA
                .filter((m) => m.type === 'apport')
                .reduce((s, m) => s + (m.montant || 0), 0);

            const totalRemboursementsCCA = mvtsA
                .filter((m) => m.type === 'remboursement')
                .reduce((s, m) => s + (m.montant || 0), 0);

            const totalInteretsComptabilises = mvtsA
                .filter((m) => m.type === 'interets')
                .reduce((s, m) => s + (m.montant || 0), 0);

            // Avances de frais rattachées
            const avA = avances.filter((av) => av.associeId === a.id && av.statut !== 'annule');
            const totalAvancesFraisNonRemboursees = avA
                .filter((av) => av.statut === 'a_rembourser')
                .reduce((s, av) => s + (av.montant || 0), 0);

            const totalAvancesFraisHistorique = avA.reduce((s, av) => s + (av.montant || 0), 0);

            // Solde total dû à l'associé (Crédit du compte 455x)
            const soldeTotal = +(
                totalApports +
                totalInteretsComptabilises +
                totalAvancesFraisNonRemboursees -
                totalRemboursementsCCA
            ).toFixed(2);

            return {
                ...a,
                totalApports,
                totalRemboursementsCCA,
                totalInteretsComptabilises,
                totalAvancesFraisNonRemboursees,
                totalAvancesFraisHistorique,
                soldeTotal,
            };
        });
    }, [associes, mouvements, avances]);

    // Totaux globaux
    const totalGlobalDu = statsAssocies.reduce((s, a) => s + a.soldeTotal, 0);
    const totalGlobalApports = statsAssocies.reduce((s, a) => s + a.totalApports, 0);
    const totalGlobalRemboursements = statsAssocies.reduce((s, a) => s + a.totalRemboursementsCCA, 0);
    const totalGlobalInterets = statsAssocies.reduce((s, a) => s + a.totalInteretsComptabilises, 0);

    // Mouvements combinés avec les avances de frais pour une vue unifiée
    const mouvementsUnifies = useMemo(() => {
        const list = [];

        // Mouvements directs CCA
        mouvements.forEach((m) => {
            const ass = associes.find((a) => a.id === m.associeId);
            const docsLies = documents.filter((d) => (m.documentIds ?? []).includes(d.id) || d.sourceId === m.id);
            const d = m.dateMouvement?.toDate ? m.dateMouvement.toDate() : new Date(m.dateMouvement);

            list.push({
                id: m.id,
                source: 'cca',
                date: d,
                dateStr: isNaN(d.getTime()) ? '' : d.toISOString().split('T')[0],
                associeId: m.associeId,
                associeNom: ass ? `${ass.nom} ${ass.prenom || ''}`.trim() : (m.associeNom || 'Associé'),
                compteCC: ass?.compteCC || '455',
                type: m.type, // 'apport' | 'remboursement' | 'interets'
                description: m.description,
                montant: m.montant,
                taux: m.taux ?? null,
                ecritureId: m.ecritureId,
                documentIds: m.documentIds ?? [],
                docs: docsLies,
            });
        });

        // Avances de frais intégrées
        avances.forEach((av) => {
            if (av.statut === 'annule') return;
            const ass = associes.find((a) => a.id === av.associeId);
            const d = av.dateAvance?.toDate ? av.dateAvance.toDate() : new Date(av.dateAvance);
            const docsLies = documents.filter((docItem) => (av.documentIds ?? []).includes(docItem.id) || docItem.sourceId === av.id);

            list.push({
                id: `av_${av.id}`,
                source: 'avance',
                date: d,
                dateStr: isNaN(d.getTime()) ? '' : d.toISOString().split('T')[0],
                associeId: av.associeId,
                associeNom: ass ? `${ass.nom} ${ass.prenom || ''}`.trim() : (av.associeNom || 'Associé'),
                compteCC: ass?.compteCC || '455',
                type: 'avance_frais',
                description: `Avance frais : ${av.description} (${av.categorieLabel || 'Dépense'})`,
                montant: av.montant,
                statutAvance: av.statut,
                ecritureId: av.ecritureAvanceId,
                documentIds: av.documentIds ?? [],
                docs: docsLies,
            });

            // Si elle a été remboursée
            if (av.statut === 'rembourse' && av.dateRemboursement) {
                const dRemb = av.dateRemboursement?.toDate ? av.dateRemboursement.toDate() : new Date(av.dateRemboursement);
                list.push({
                    id: `av_remb_${av.id}`,
                    source: 'avance_remb',
                    date: dRemb,
                    dateStr: isNaN(dRemb.getTime()) ? '' : dRemb.toISOString().split('T')[0],
                    associeId: av.associeId,
                    associeNom: ass ? `${ass.nom} ${ass.prenom || ''}`.trim() : (av.associeNom || 'Associé'),
                    compteCC: ass?.compteCC || '455',
                    type: 'remboursement',
                    description: `Remboursement avance : ${av.description}`,
                    montant: av.montant,
                    ecritureId: av.ecritureVersementId,
                    documentIds: [],
                    docs: [],
                });
            }
        });

        // Trier par date décroissante
        list.sort((a, b) => b.date.getTime() - a.date.getTime());

        return filtreAssocie ? list.filter((m) => m.associeId === filtreAssocie) : list;
    }, [mouvements, avances, associes, documents, filtreAssocie]);

    // ─── Enregistrement d'un nouvel apport ou remboursement CCA ─────────────
    async function handleSaveMouvement(e) {
        e.preventDefault();
        setFormError('');
        setFormSuccess('');

        const montantNum = parseFloat(formMontant);
        if (!formAssocieId) { setFormError('Sélectionnez un associé.'); return; }
        if (isNaN(montantNum) || montantNum <= 0) { setFormError('Montant invalide.'); return; }
        if (!formDate) { setFormError('Date requise.'); return; }
        if (!formDescription.trim()) { setFormError('Description requise.'); return; }

        setSavingMvt(true);
        try {
            const ass = associes.find((a) => a.id === formAssocieId);
            const compteCC = ass.compteCC || '455';
            const nomAssocie = `${ass.nom} ${ass.prenom || ''}`.trim();
            const dateStr = formDate;

            let ecritureId = null;

            if (formType === 'apport') {
                // APPORT : La société encaisse des fonds de l'associé
                // Débit 512 (Banque) / Crédit 455x (Compte courant associé)
                const res = await ecrireEcriture({
                    journal: 'BQ',
                    date: dateStr,
                    libelle: `Apport CCA — ${nomAssocie} — ${formDescription}`,
                    sourceType: 'cca_apport',
                    mouvements: [
                        { compte: '512', libelle: `Banque — Apport ${nomAssocie}`, debit: montantNum, credit: 0 },
                        { compte: compteCC, libelle: `Compte courant ${nomAssocie}`, debit: 0, credit: montantNum },
                    ],
                });
                ecritureId = res.ecritureId;
            } else {
                // REMBOURSEMENT : La société rembourse l'associé
                // Débit 455x (Compte courant) / Crédit 512 (Banque)
                const res = await ecrireEcriture({
                    journal: 'BQ',
                    date: dateStr,
                    libelle: `Remboursement CCA — ${nomAssocie} — ${formDescription}`,
                    sourceType: 'cca_remboursement',
                    mouvements: [
                        { compte: compteCC, libelle: `Compte courant ${nomAssocie}`, debit: montantNum, credit: 0 },
                        { compte: '512', libelle: `Banque — Remboursement ${nomAssocie}`, debit: 0, credit: montantNum },
                    ],
                });
                ecritureId = res.ecritureId;
            }

            // Enregistrer le mouvement dans Firestore
            const mvtDocRef = await addDoc(collection(db, 'ccaMouvements'), {
                associeId: formAssocieId,
                associeNom: nomAssocie,
                type: formType,
                montant: montantNum,
                dateMouvement: new Date(formDate),
                description: formDescription.trim(),
                taux: formTaux ? parseFloat(formTaux) : null,
                documentIds: formDocIds,
                ecritureId,
                createdAt: serverTimestamp(),
            });

            // Mettre à jour les documents pour les lier
            for (const docId of formDocIds) {
                await updateDoc(doc(db, 'documents', docId), {
                    sourceId: mvtDocRef.id,
                    sourceType: `cca_${formType}`,
                }).catch(() => {});
            }

            // Mettre à jour le taux conventionnel par défaut de l'associé s'il a été renseigné
            if (formTaux && parseFloat(formTaux) >= 0) {
                await updateDoc(doc(db, 'associes', formAssocieId), {
                    tauxInteretCCA: parseFloat(formTaux),
                    updatedAt: serverTimestamp(),
                });
            }

            setFormSuccess(`Opération de ${formType === 'apport' ? 'l\'apport' : 'remboursement'} enregistrée avec succès.`);
            setFormMontant('');
            setFormDescription('');
            setFormDocIds([]);
            setShowFormMvt(false);
            loadData();
        } catch (err) {
            setFormError(err.message || 'Erreur lors de l\'enregistrement.');
        } finally {
            setSavingMvt(false);
        }
    }

    // ─── Calculateur d'intérêts prorata temporis ─────────────────────────────
    const calculInterets = useMemo(() => {
        if (!calcAssocieId || !calcDateDebut || !calcDateFin) return null;

        const dDebut = new Date(calcDateDebut);
        const dFin = new Date(calcDateFin);
        if (dDebut >= dFin) return null;

        // Trouver l'associé
        const ass = statsAssocies.find((a) => a.id === calcAssocieId);
        if (!ass) return null;

        // Collecter tous les mouvements chronologiques de cet associé
        const mvtsAss = mouvementsUnifies
            .filter((m) => m.associeId === calcAssocieId)
            .map((m) => ({
                date: m.date,
                delta: m.type === 'apport' || m.type === 'avance_frais' || m.type === 'interets'
                    ? (m.statutAvance === 'annule' ? 0 : m.montant)
                    : -m.montant,
                description: m.description,
            }))
            .sort((a, b) => a.date.getTime() - b.date.getTime());

        // Calcul du solde initial à dDebut
        let soldeCourant = 0;
        const timeline = [];

        // Solde avant la date de début
        mvtsAss.forEach((m) => {
            if (m.date < dDebut) {
                soldeCourant += m.delta;
            }
        });

        // Mouvements dans la période
        let dateEtape = new Date(dDebut);
        let interetsBruts = 0;
        let totalJours = 0;
        let sommeProduitsPonderes = 0;

        const mvtsPeriode = mvtsAss.filter((m) => m.date >= dDebut && m.date <= dFin);

        for (const m of mvtsPeriode) {
            const nbJours = Math.max(0, Math.round((m.date.getTime() - dateEtape.getTime()) / (1000 * 60 * 60 * 24)));
            if (nbJours > 0 && soldeCourant > 0) {
                const fractionAnnee = nbJours / 365;
                const intTranche = soldeCourant * (calcTaux / 100) * fractionAnnee;
                interetsBruts += intTranche;
                sommeProduitsPonderes += soldeCourant * nbJours;
                totalJours += nbJours;

                timeline.push({
                    debut: new Date(dateEtape),
                    fin: new Date(m.date),
                    jours: nbJours,
                    solde: soldeCourant,
                    interets: intTranche,
                });
            }
            soldeCourant += m.delta;
            dateEtape = new Date(m.date);
        }

        // Dernière tranche jusqu'à dFin
        const nbJoursFin = Math.max(0, Math.round((dFin.getTime() - dateEtape.getTime()) / (1000 * 60 * 60 * 24)));
        if (nbJoursFin > 0 && soldeCourant > 0) {
            const fractionAnnee = nbJoursFin / 365;
            const intTranche = soldeCourant * (calcTaux / 100) * fractionAnnee;
            interetsBruts += intTranche;
            sommeProduitsPonderes += soldeCourant * nbJoursFin;
            totalJours += nbJoursFin;

            timeline.push({
                debut: new Date(dateEtape),
                fin: new Date(dFin),
                jours: nbJoursFin,
                solde: soldeCourant,
                interets: intTranche,
            });
        }

        // Si aucun mouvement dans la période mais solde positif continu
        if (timeline.length === 0 && soldeCourant > 0) {
            const nbJoursTotal = Math.max(1, Math.round((dFin.getTime() - dDebut.getTime()) / (1000 * 60 * 60 * 24)));
            const fractionAnnee = nbJoursTotal / 365;
            interetsBruts = soldeCourant * (calcTaux / 100) * fractionAnnee;
            totalJours = nbJoursTotal;
            sommeProduitsPonderes = soldeCourant * nbJoursTotal;
            timeline.push({
                debut: dDebut,
                fin: dFin,
                jours: nbJoursTotal,
                solde: soldeCourant,
                interets: interetsBruts,
            });
        }

        interetsBruts = +interetsBruts.toFixed(2);
        const soldeMoyenPondere = totalJours > 0 ? +(sommeProduitsPonderes / totalJours).toFixed(2) : soldeCourant;

        // Comparaison avec le plafond fiscal déductible
        const interetsDeductiblesMax = +(soldeMoyenPondere * (calcTauxLegalPlafond / 100) * (totalJours / 365)).toFixed(2);
        const depassementNonDeductible = calcTaux > calcTauxLegalPlafond
            ? +Math.max(0, interetsBruts - interetsDeductiblesMax).toFixed(2)
            : 0;

        return {
            associe: ass,
            soldeActuel: ass.soldeTotal,
            soldeMoyenPondere,
            totalJours,
            interetsBruts,
            interetsDeductibles: Math.min(interetsBruts, interetsDeductiblesMax),
            depassementNonDeductible,
            depassement: calcTaux > calcTauxLegalPlafond,
            timeline,
        };
    }, [calcAssocieId, calcDateDebut, calcDateFin, calcTaux, calcTauxLegalPlafond, statsAssocies, mouvementsUnifies]);

    // ─── Comptabilisation automatique des intérêts ──────────────────────────
    async function handleComptabiliserInterets() {
        if (!calculInterets || calculInterets.interetsBruts <= 0) return;
        const ass = calculInterets.associe;
        const msg = `Comptabiliser ${formatMontant(calculInterets.interetsBruts)} d'intérêts de CCA pour ${ass.nom} ?\n\nÉcriture générée dans le journal OD :\n- Débit 6615 (Charges financières) : ${formatMontant(calculInterets.interetsBruts)}\n- Crédit ${ass.compteCC || '455'} (Compte courant ${ass.nom}) : ${formatMontant(calculInterets.interetsBruts)}`;

        if (!window.confirm(msg)) return;

        setComptabilisationEnCours(true);
        setCalcSuccess('');
        try {
            const dateEcriture = calcDateFin;
            const libelle = `Intérêts CCA ${ass.nom} — ${calcDateDebut} au ${calcDateFin} (taux ${calcTaux}%)`;

            // Écriture OD : Débit 6615 / Crédit 455x
            const { ecritureId } = await ecrireEcriture({
                journal: 'OD',
                date: dateEcriture,
                libelle,
                sourceType: 'cca_interets',
                mouvements: [
                    { compte: '6615', libelle: `Intérêts CCA — ${ass.nom}`, debit: calculInterets.interetsBruts, credit: 0 },
                    { compte: ass.compteCC || '455', libelle: `Compte courant ${ass.nom}`, debit: 0, credit: calculInterets.interetsBruts },
                ],
            });

            // Enregistrer dans ccaMouvements
            await addDoc(collection(db, 'ccaMouvements'), {
                associeId: ass.id,
                associeNom: `${ass.nom} ${ass.prenom || ''}`.trim(),
                type: 'interets',
                montant: calculInterets.interetsBruts,
                dateMouvement: new Date(dateEcriture),
                description: libelle,
                taux: calcTaux,
                ecritureId,
                periodeDebut: new Date(calcDateDebut),
                periodeFin: new Date(calcDateFin),
                partDeductible: calculInterets.interetsDeductibles,
                partNonDeductible: calculInterets.depassementNonDeductible,
                createdAt: serverTimestamp(),
            });

            setCalcSuccess(`Intérêts comptabilisés avec succès ! Écriture ${ecritureId} générée.`);
            loadData();
        } catch (e) {
            alert('Erreur comptabilisation : ' + e.message);
        } finally {
            setComptabilisationEnCours(false);
        }
    }

    return (
        <div>
            {/* Page Header */}
            <div className="page-header">
                <div>
                    <h1>Comptes Courants d'Associés (CCA)</h1>
                    <p>Suivi des apports, remboursements, pièces justificatives et intérêts déductibles</p>
                </div>
                <div className="page-header__actions">
                    <button className="btn btn--ghost" onClick={() => { setActiveTab('interets'); }}>
                        Simuler / Calculer intérêts
                    </button>
                    <button className="btn btn--primary" onClick={() => { setShowFormMvt(true); setFormError(''); setFormSuccess(''); }}>
                        Nouvel apport / Remboursement
                    </button>
                </div>
            </div>

            {/* Avertissement légal / fiscal */}
            <div className="notice notice--info" style={{ marginBottom: 20 }}>
                <span>
                    <strong>Cadre juridique & fiscal :</strong> Le Compte Courant d'Associé (compte <code>455</code>) enregistre les avances de trésorerie et avances de frais consenties à la société. Les intérêts versés sont déductibles du résultat fiscal dans la limite légale fixée par l'article 39-1-3° du CGI (taux moyen de rendement des emprunts d'État). Tout excédent doit faire l'objet d'une réintégration fiscale.
                </span>
            </div>

            {/* Cartes KPI */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
                <div className="card" style={{ padding: '16px 20px', marginBottom: 0 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
                        Solde total dû aux associés
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: totalGlobalDu > 0 ? 'var(--accent)' : 'var(--text)' }}>
                        {formatMontant(totalGlobalDu)}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Dette au passif (compte 455)</div>
                </div>

                <div className="card" style={{ padding: '16px 20px', marginBottom: 0 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
                        Total apports en trésorerie
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--success)' }}>
                        {formatMontant(totalGlobalApports)}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Fonds versés sur compte 512</div>
                </div>

                <div className="card" style={{ padding: '16px 20px', marginBottom: 0 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
                        Total remboursements
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--info)' }}>
                        {formatMontant(totalGlobalRemboursements)}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Remboursé aux associés</div>
                </div>

                <div className="card" style={{ padding: '16px 20px', marginBottom: 0 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
                        Intérêts courus / comptabilisés
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--warning)' }}>
                        {formatMontant(totalGlobalInterets)}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Charges financières (compte 6615)</div>
                </div>
            </div>

            {/* Barre d'onglets */}
            <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--border)', marginBottom: 20 }}>
                <button
                    className={`btn ${activeTab === 'synthese' ? 'btn--primary' : 'btn--ghost'}`}
                    style={{ borderRadius: '6px 6px 0 0', borderBottom: 'none' }}
                    onClick={() => setActiveTab('synthese')}
                >
                    Synthèse par associé
                </button>
                <button
                    className={`btn ${activeTab === 'mouvements' ? 'btn--primary' : 'btn--ghost'}`}
                    style={{ borderRadius: '6px 6px 0 0', borderBottom: 'none' }}
                    onClick={() => setActiveTab('mouvements')}
                >
                    Historique des mouvements & Justificatifs ({mouvementsUnifies.length})
                </button>
                <button
                    className={`btn ${activeTab === 'interets' ? 'btn--primary' : 'btn--ghost'}`}
                    style={{ borderRadius: '6px 6px 0 0', borderBottom: 'none' }}
                    onClick={() => setActiveTab('interets')}
                >
                    Calculateur d'intérêts & Plafond fiscal
                </button>
            </div>

            {/* Modal / Formulaire Nouvel apport / Remboursement */}
            {showFormMvt && (
                <div className="card" style={{ borderColor: 'var(--accent)', borderWidth: 2, marginBottom: 24 }}>
                    <div className="card__title" style={{ justifyContent: 'space-between' }}>
                        <span>Nouveau mouvement de compte courant (CCA)</span>
                        <button className="btn btn--sm btn--ghost" onClick={() => setShowFormMvt(false)}>Fermer ✕</button>
                    </div>

                    {formError && <div className="notice notice--danger">{formError}</div>}
                    {formSuccess && <div className="notice notice--success">{formSuccess}</div>}

                    <form onSubmit={handleSaveMouvement}>
                        <div className="form-row--3">
                            <div className="form-group">
                                <label className="form-label">Associé concerné</label>
                                <select
                                    className="form-select"
                                    value={formAssocieId}
                                    onChange={(e) => {
                                        setFormAssocieId(e.target.value);
                                        const ass = associes.find((a) => a.id === e.target.value);
                                        if (ass?.tauxInteretCCA) setFormTaux(ass.tauxInteretCCA);
                                    }}
                                    required
                                >
                                    {associes.map((a) => (
                                        <option key={a.id} value={a.id}>
                                            {a.nom} {a.prenom} (Compte {a.compteCC || '455'})
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Type d'opération</label>
                                <select
                                    className="form-select"
                                    value={formType}
                                    onChange={(e) => setFormType(e.target.value)}
                                >
                                    <option value="apport">Apport en CCA (L'associé prête à la société)</option>
                                    <option value="remboursement">Remboursement de CCA (La société rembourse)</option>
                                </select>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Date de l'opération</label>
                                <input
                                    type="date"
                                    className="form-input"
                                    value={formDate}
                                    onChange={(e) => setFormDate(e.target.value)}
                                    required
                                />
                            </div>
                        </div>

                        <div className="form-row">
                            <div className="form-group">
                                <label className="form-label">Montant (€)</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    min="0.01"
                                    placeholder="Ex. 5000.00"
                                    className="form-input"
                                    value={formMontant}
                                    onChange={(e) => setFormMontant(e.target.value)}
                                    required
                                />
                            </div>

                            <div className="form-group">
                                <label className="form-label">
                                    Taux d'intérêt annuel conventionnel (%)
                                    <Tooltip text="Taux d'intérêt annuel fixé par convention de compte courant d'associé. Les intérêts sont déductibles dans la limite du taux légal officiel." />
                                </label>
                                <input
                                    type="number"
                                    step="0.01"
                                    placeholder="Ex. 5.00"
                                    className="form-input"
                                    value={formTaux}
                                    onChange={(e) => setFormTaux(e.target.value)}
                                />
                                <div className="form-hint">Plafond légal indicatif : {TAUX_LEGAL_DEFECT_2026} %</div>
                            </div>
                        </div>

                        <div className="form-group">
                            <label className="form-label">Description / Motif</label>
                            <input
                                type="text"
                                placeholder="Ex. Virement apport trésorerie pour achat matériel informatique"
                                className="form-input"
                                value={formDescription}
                                onChange={(e) => setFormDescription(e.target.value)}
                                required
                            />
                        </div>

                        {/* Téléversement de justificatifs */}
                        <div className="form-group">
                            <label className="form-label">
                                Pièces justificatives (Reçu de virement, convention de blocage, etc.)
                            </label>
                            <FileUpload
                                sourceType={`cca_${formType}`}
                                onUploaded={({ documentId }) => {
                                    setFormDocIds((prev) => [...prev, documentId]);
                                }}
                            />
                            {formDocIds.length > 0 && (
                                <div className="form-hint" style={{ color: 'var(--success)' }}>
                                    ✓ {formDocIds.length} justificatif(s) prêt(s) à être rattaché(s).
                                </div>
                            )}
                        </div>

                        {/* Prévisualisation de l'écriture */}
                        <div className="notice notice--info" style={{ fontSize: 12, marginTop: 12 }}>
                            <strong>Écriture comptable générée automatiquement :</strong>
                            {formType === 'apport' ? (
                                <div>
                                    • Débit <code>512</code> Banque : {formMontant ? formatMontant(parseFloat(formMontant)) : '—'}
                                    <br />
                                    • Crédit <code>{associes.find((a) => a.id === formAssocieId)?.compteCC || '455'}</code> Compte courant associé : {formMontant ? formatMontant(parseFloat(formMontant)) : '—'}
                                </div>
                            ) : (
                                <div>
                                    • Débit <code>{associes.find((a) => a.id === formAssocieId)?.compteCC || '455'}</code> Compte courant associé : {formMontant ? formatMontant(parseFloat(formMontant)) : '—'}
                                    <br />
                                    • Crédit <code>512</code> Banque : {formMontant ? formatMontant(parseFloat(formMontant)) : '—'}
                                </div>
                            )}
                        </div>

                        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                            <button type="submit" className="btn btn--primary" disabled={savingMvt}>
                                {savingMvt ? 'Enregistrement et génération de l\'écriture...' : 'Valider et comptabiliser'}
                            </button>
                            <button type="button" className="btn btn--ghost" onClick={() => setShowFormMvt(false)}>
                                Annuler
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* ─── ONGLET 1 : SYNTHÈSE PAR ASSOCIÉ ─────────────────────────── */}
            {activeTab === 'synthese' && (
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div className="table-wrap">
                        <table>
                            <thead>
                                <tr>
                                    <th>Associé</th>
                                    <th>Compte CC</th>
                                    <th style={{ textAlign: 'right' }}>Total Apports</th>
                                    <th style={{ textAlign: 'right' }}>Avances frais</th>
                                    <th style={{ textAlign: 'right' }}>Remboursements</th>
                                    <th style={{ textAlign: 'right' }}>Intérêts comptabilisés</th>
                                    <th style={{ textAlign: 'right' }}>Solde actuel dû</th>
                                    <th style={{ textAlign: 'center' }}>Taux conventionnel</th>
                                    <th style={{ textAlign: 'right' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {statsAssocies.map((a) => (
                                    <tr key={a.id}>
                                        <td>
                                            <div style={{ fontWeight: 600 }}>{a.nom} {a.prenom}</div>
                                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{a.role} · {a.pourcentageParts}%</div>
                                        </td>
                                        <td><code>{a.compteCC || '455'}</code></td>
                                        <td style={{ textAlign: 'right', color: 'var(--success)' }}>
                                            {formatMontant(a.totalApports)}
                                        </td>
                                        <td style={{ textAlign: 'right', color: 'var(--text)' }}>
                                            {formatMontant(a.totalAvancesFraisNonRemboursees)}
                                        </td>
                                        <td style={{ textAlign: 'right', color: 'var(--info)' }}>
                                            {formatMontant(a.totalRemboursementsCCA)}
                                        </td>
                                        <td style={{ textAlign: 'right', color: 'var(--warning)' }}>
                                            {formatMontant(a.totalInteretsComptabilises)}
                                        </td>
                                        <td style={{ textAlign: 'right', fontWeight: 700, fontSize: 14, color: a.soldeTotal > 0 ? 'var(--accent)' : 'var(--text-muted)' }}>
                                            {formatMontant(a.soldeTotal)}
                                        </td>
                                        <td style={{ textAlign: 'center' }}>
                                            {a.tauxInteretCCA != null ? (
                                                <span className="badge badge--info">{a.tauxInteretCCA} %</span>
                                            ) : (
                                                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Non défini</span>
                                            )}
                                        </td>
                                        <td style={{ textAlign: 'right' }}>
                                            <div style={{ display: 'inline-flex', gap: 6 }}>
                                                <button
                                                    className="btn btn--sm btn--ghost"
                                                    onClick={() => {
                                                        setFormAssocieId(a.id);
                                                        setFormType('apport');
                                                        setShowFormMvt(true);
                                                    }}
                                                >
                                                    + Apport
                                                </button>
                                                <button
                                                    className="btn btn--sm btn--ghost"
                                                    onClick={() => {
                                                        setFormAssocieId(a.id);
                                                        setFormType('remboursement');
                                                        setShowFormMvt(true);
                                                    }}
                                                >
                                                    Rembourser
                                                </button>
                                                <button
                                                    className="btn btn--sm btn--primary"
                                                    onClick={() => {
                                                        setCalcAssocieId(a.id);
                                                        if (a.tauxInteretCCA) setCalcTaux(a.tauxInteretCCA);
                                                        setActiveTab('interets');
                                                    }}
                                                >
                                                    Intérêts
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr>
                                    <td><strong>TOTAL GÉNÉRAL</strong></td>
                                    <td></td>
                                    <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--success)' }}>
                                        {formatMontant(totalGlobalApports)}
                                    </td>
                                    <td></td>
                                    <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--info)' }}>
                                        {formatMontant(totalGlobalRemboursements)}
                                    </td>
                                    <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--warning)' }}>
                                        {formatMontant(totalGlobalInterets)}
                                    </td>
                                    <td style={{ textAlign: 'right', fontWeight: 700, fontSize: 15, color: 'var(--accent)' }}>
                                        {formatMontant(totalGlobalDu)}
                                    </td>
                                    <td colSpan={2}></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            )}

            {/* ─── ONGLET 2 : MOUVEMENTS & JUSTIFICATIFS ───────────────────── */}
            {activeTab === 'mouvements' && (
                <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <label style={{ fontSize: 13, fontWeight: 500 }}>Filtrer par associé :</label>
                            <select
                                className="form-select"
                                style={{ width: 220 }}
                                value={filtreAssocie}
                                onChange={(e) => setFiltreAssocie(e.target.value)}
                            >
                                <option value="">Tous les associés</option>
                                {associes.map((a) => (
                                    <option key={a.id} value={a.id}>{a.nom} {a.prenom}</option>
                                ))}
                            </select>
                        </div>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            {mouvementsUnifies.length} opération(s) trouvée(s)
                        </span>
                    </div>

                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                        <div className="table-wrap">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Date</th>
                                        <th>Associé</th>
                                        <th>Type</th>
                                        <th>Description</th>
                                        <th>Justificatifs</th>
                                        <th style={{ textAlign: 'right' }}>Débit (Sortie)</th>
                                        <th style={{ textAlign: 'right' }}>Crédit (Entrée)</th>
                                        <th>Écriture</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {mouvementsUnifies.length === 0 ? (
                                        <tr>
                                            <td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 30 }}>
                                                Aucun mouvement CCA enregistré.
                                            </td>
                                        </tr>
                                    ) : (
                                        mouvementsUnifies.map((m) => {
                                            const isCredit = m.type === 'apport' || m.type === 'avance_frais' || m.type === 'interets';
                                            return (
                                                <tr key={m.id}>
                                                    <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{formatDate(m.date)}</td>
                                                    <td style={{ fontWeight: 500 }}>{m.associeNom}</td>
                                                    <td>
                                                        {m.type === 'apport' && <span className="badge badge--success">Apport CCA</span>}
                                                        {m.type === 'remboursement' && <span className="badge badge--info">Remboursement</span>}
                                                        {m.type === 'avance_frais' && <span className="badge badge--warning">Avance frais</span>}
                                                        {m.type === 'interets' && <span className="badge badge--warning">Intérêts CCA</span>}
                                                    </td>
                                                    <td>
                                                        <div>{m.description}</div>
                                                        {m.taux != null && (
                                                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Taux convenu : {m.taux}%</span>
                                                        )}
                                                    </td>
                                                    <td>
                                                        {m.docs && m.docs.length > 0 ? (
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                                                {m.docs.map((d) => (
                                                                    <a
                                                                        key={d.id}
                                                                        href={d.downloadURL}
                                                                        target="_blank"
                                                                        rel="noopener noreferrer"
                                                                        className="badge badge--muted"
                                                                        style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                                                                    >
                                                                        📎 {d.nom}
                                                                    </a>
                                                                ))}
                                                            </div>
                                                        ) : (
                                                            <span style={{ color: 'var(--text-light)', fontSize: 11 }}>Aucun</span>
                                                        )}
                                                    </td>
                                                    <td style={{ textAlign: 'right', fontWeight: 500, color: !isCredit ? 'var(--info)' : 'var(--text-muted)' }}>
                                                        {!isCredit ? formatMontant(m.montant) : '—'}
                                                    </td>
                                                    <td style={{ textAlign: 'right', fontWeight: 500, color: isCredit ? 'var(--success)' : 'var(--text-muted)' }}>
                                                        {isCredit ? formatMontant(m.montant) : '—'}
                                                    </td>
                                                    <td>
                                                        {m.ecritureId ? (
                                                            <code style={{ fontSize: 11 }}>{m.ecritureId.slice(0, 7)}...</code>
                                                        ) : (
                                                            <span style={{ color: 'var(--text-light)', fontSize: 11 }}>—</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* ─── ONGLET 3 : CALCULATEUR D'INTÉRÊTS & PLAFOND FISCAL ───────── */}
            {activeTab === 'interets' && (
                <div>
                    {calcSuccess && <div className="notice notice--success" style={{ marginBottom: 16 }}>{calcSuccess}</div>}

                    <div className="card">
                        <div className="card__title">
                            Simulateur & Calculateur d'intérêts de CCA (Prorata temporis)
                        </div>

                        <div className="form-row--3">
                            <div className="form-group">
                                <label className="form-label">Associé</label>
                                <select
                                    className="form-select"
                                    value={calcAssocieId}
                                    onChange={(e) => {
                                        setCalcAssocieId(e.target.value);
                                        const ass = associes.find((a) => a.id === e.target.value);
                                        if (ass?.tauxInteretCCA) setCalcTaux(ass.tauxInteretCCA);
                                    }}
                                >
                                    {associes.map((a) => (
                                        <option key={a.id} value={a.id}>
                                            {a.nom} {a.prenom} (Solde : {formatMontant(statsAssocies.find((s) => s.id === a.id)?.soldeTotal || 0)})
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Période du</label>
                                <input
                                    type="date"
                                    className="form-input"
                                    value={calcDateDebut}
                                    onChange={(e) => setCalcDateDebut(e.target.value)}
                                />
                            </div>

                            <div className="form-group">
                                <label className="form-label">Au</label>
                                <input
                                    type="date"
                                    className="form-input"
                                    value={calcDateFin}
                                    onChange={(e) => setCalcDateFin(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="form-row">
                            <div className="form-group">
                                <label className="form-label">
                                    Taux contractuel appliqué (%)
                                    <Tooltip text="Taux convenu dans les statuts ou la convention de compte courant entre l'associé et la société." />
                                </label>
                                <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    className="form-input"
                                    value={calcTaux}
                                    onChange={(e) => setCalcTaux(parseFloat(e.target.value) || 0)}
                                />
                            </div>

                            <div className="form-group">
                                <label className="form-label">
                                    Plafond légal déductible (BOFiP / TMP %)
                                    <Tooltip text="Taux maximal d'intérêts déductibles des comptes courants d'associés publié par l'administration fiscale au Bulletin Officiel des Finances Publiques." />
                                </label>
                                <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    className="form-input"
                                    value={calcTauxLegalPlafond}
                                    onChange={(e) => setCalcTauxLegalPlafond(parseFloat(e.target.value) || 0)}
                                />
                                <div className="form-hint">Référence CGI Art. 39-1-3°</div>
                            </div>
                        </div>

                        {/* Résultats du calcul */}
                        {calculInterets && (
                            <div style={{ marginTop: 20 }}>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
                                    <div className="card" style={{ background: 'var(--bg2)', padding: '12px 16px', marginBottom: 0 }}>
                                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Solde moyen pondéré</div>
                                        <div style={{ fontSize: 18, fontWeight: 700 }}>{formatMontant(calculInterets.soldeMoyenPondere)}</div>
                                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Sur {calculInterets.totalJours} jours calculés</div>
                                    </div>

                                    <div className="card" style={{ background: 'var(--bg2)', padding: '12px 16px', marginBottom: 0 }}>
                                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Total intérêts bruts dus</div>
                                        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent)' }}>
                                            {formatMontant(calculInterets.interetsBruts)}
                                        </div>
                                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Charge pour la société</div>
                                    </div>

                                    <div className="card" style={{ background: 'var(--bg2)', padding: '12px 16px', marginBottom: 0 }}>
                                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Part fiscalement déductible</div>
                                        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--success)' }}>
                                            {formatMontant(calculInterets.interetsDeductibles)}
                                        </div>
                                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Déductible à 100% de l'IS</div>
                                    </div>

                                    <div className="card" style={{ background: 'var(--bg2)', padding: '12px 16px', marginBottom: 0 }}>
                                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Quote-part non déductible</div>
                                        <div style={{ fontSize: 18, fontWeight: 700, color: calculInterets.depassementNonDeductible > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>
                                            {formatMontant(calculInterets.depassementNonDeductible)}
                                        </div>
                                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>À réintégrer fiscalement (tableau 2058-A)</div>
                                    </div>
                                </div>

                                {calculInterets.depassement && (
                                    <div className="notice notice--warning">
                                        <strong>Attention — Dépassement du taux légal :</strong> Le taux contractuel appliqué ({calcTaux} %) dépasse le plafond légal de {calcTauxLegalPlafond} %. La fraction excédentaire de <strong>{formatMontant(calculInterets.depassementNonDeductible)}</strong> ne sera pas déductible du résultat fiscal et devra être réintégrée lors de la liasse fiscale (déclaration 2065).
                                    </div>
                                )}

                                {/* Tranches de calcul */}
                                {calculInterets.timeline.length > 0 && (
                                    <div style={{ marginTop: 16 }}>
                                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase' }}>
                                            Détail des tranches de calcul prorata temporis
                                        </div>
                                        <div className="table-wrap">
                                            <table>
                                                <thead>
                                                    <tr>
                                                        <th>Tranche</th>
                                                        <th>Nombre de jours</th>
                                                        <th style={{ textAlign: 'right' }}>Solde créditeur</th>
                                                        <th style={{ textAlign: 'right' }}>Formule</th>
                                                        <th style={{ textAlign: 'right' }}>Intérêts de la tranche</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {calculInterets.timeline.map((t, idx) => (
                                                        <tr key={idx}>
                                                            <td>Du {formatDate(t.debut)} au {formatDate(t.fin)}</td>
                                                            <td>{t.jours} jour(s)</td>
                                                            <td style={{ textAlign: 'right', fontWeight: 500 }}>{formatMontant(t.solde)}</td>
                                                            <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-muted)' }}>
                                                                {formatMontant(t.solde)} × {calcTaux}% × ({t.jours}/365)
                                                            </td>
                                                            <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--accent)' }}>
                                                                {formatMontant(t.interets)}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}

                                {/* Bouton de comptabilisation */}
                                <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 16, background: 'var(--bg3)', borderRadius: 'var(--radius)' }}>
                                    <div>
                                        <div style={{ fontWeight: 600 }}>Comptabiliser ces intérêts en charges financières</div>
                                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                            Génère l'écriture Débit <code>6615</code> / Crédit <code>{calculInterets.associe.compteCC || '455'}</code> dans le journal OD à la date du {formatDate(calcDateFin)}.
                                        </div>
                                    </div>
                                    <button
                                        className="btn btn--primary"
                                        disabled={comptabilisationEnCours || calculInterets.interetsBruts <= 0}
                                        onClick={handleComptabiliserInterets}
                                    >
                                        {comptabilisationEnCours ? 'Génération en cours...' : `Comptabiliser ${formatMontant(calculInterets.interetsBruts)}`}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
