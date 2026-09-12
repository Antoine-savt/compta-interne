/**
 * comptaService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Moteur de calcul comptable en temps réel conforme aux normes françaises (PCG).
 * Agrège les écritures de la collection Firestore `ecritures` (statut === 'active')
 * et produit :
 *  - Grand Livre (par compte avec solde progressif)
 *  - Balance Générale (6 colonnes avec totaux et équilibre)
 *  - Bilan (Actif / Passif avec résultat de l'exercice intégré)
 *  - Compte de Résultat (Charges, Produits, SIG, Résultat net)
 *  - Export FEC (Fichier des Écritures Comptables normalisé)
 */

import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';

// ─── Dictionnaires de libellés par défaut du Plan Comptable Général (PCG) ───
export const NOMS_COMPTES = {
    // Classe 1
    '101': 'Capital social',
    '106': 'Réserves',
    '110': 'Report à nouveau (solde créditeur)',
    '119': 'Report à nouveau (solde débiteur)',
    '120': 'Résultat de l\'exercice (bénéfice)',
    '129': 'Résultat de l\'exercice (perte)',
    '164': 'Emprunts auprès des établissements de crédit',
    // Classe 2
    '205': 'Concessions et droits similaires, brevets, licences, logiciels',
    '218': 'Autre matériel et outillage',
    '2183': 'Matériel informatique et télécoms',
    '2818': 'Amortissements des immobilisations corporelles',
    // Classe 4
    '401': 'Fournisseurs',
    '411': 'Clients',
    '421': 'Personnel - Rémunérations dues',
    '431': 'Sécurité sociale et autres organismes sociaux (URSSAF)',
    '44551': 'TVA à décaisser',
    '44566': 'TVA déductible sur autres biens et services',
    '44571': 'TVA collectée',
    '455': 'Associés - Comptes courants',
    '4550': 'Associés - Comptes courants collectifs',
    '4551': 'Associé 1 - Compte courant',
    '4552': 'Associé 2 - Compte courant',
    '4558': 'Associés - Intérêts courus',
    '457': 'Associés - Dividendes à payer',
    // Classe 5
    '512': 'Banque',
    '514': 'Chèques postaux',
    '530': 'Caisse',
    '580': 'Virements internes',
    // Classe 6
    '606': 'Achats non stockés de matières et fournitures',
    '6063': 'Fournitures d\'entretien et de petit équipement',
    '6064': 'Fournitures administratives',
    '6068': 'Autres matières et fournitures',
    '6135': 'Locations mobilières / Abonnements SaaS & Cloud',
    '616': 'Primes d\'assurance',
    '6226': 'Honoraires comptables et juridiques',
    '6231': 'Annonces et insertions publicitaires',
    '6234': 'Cadeaux à la clientèle',
    '6251': 'Voyages et déplacements',
    '6256': 'Missions',
    '6257': 'Réceptions & Repas d\'affaires',
    '626': 'Frais postaux et télécommunications',
    '627': 'Services bancaires et commissions (Stripe, etc.)',
    '635': 'Autres impôts et taxes',
    '641': 'Rémunérations du personnel',
    '645': 'Charges de sécurité sociale et de prévoyance',
    '6615': 'Intérêts des comptes courants et dépôts créditeurs (CCA)',
    '6616': 'Intérêts bancaires et sur emprunts',
    '6811': 'Dotations aux amortissements sur immobilisations',
    // Classe 7
    '706': 'Prestations de services',
    '707': 'Ventes de marchandises',
    '708': 'Produits des activités annexes',
    '740': 'Subventions d\'exploitation',
    '758': 'Produits divers de gestion courante',
    '768': 'Autres produits financiers',
    '771': 'Produits exceptionnels sur opérations de gestion',
};

export function getLibelleCompte(code) {
    if (!code) return 'Compte inconnu';
    const strCode = String(code).trim();
    if (NOMS_COMPTES[strCode]) return NOMS_COMPTES[strCode];
    // Chercher un parent préfixe (ex: 4551 -> 455)
    for (let len = strCode.length - 1; len >= 2; len--) {
        const prefix = strCode.slice(0, len);
        if (NOMS_COMPTES[prefix]) return `${NOMS_COMPTES[prefix]} (${strCode})`;
    }
    const c1 = strCode.charAt(0);
    if (c1 === '1') return `Capitaux (${strCode})`;
    if (c1 === '2') return `Immobilisations (${strCode})`;
    if (c1 === '3') return `Stocks (${strCode})`;
    if (c1 === '4') return `Compte de tiers (${strCode})`;
    if (c1 === '5') return `Compte financier / Trésorerie (${strCode})`;
    if (c1 === '6') return `Compte de charges (${strCode})`;
    if (c1 === '7') return `Compte de produits (${strCode})`;
    return `Compte ${strCode}`;
}

// ─── Chargement des écritures ───────────────────────────────────────────────

/**
 * Récupère toutes les écritures actives.
 * @param {Object} [filtres]
 * @param {Date|string} [filtres.dateDebut]
 * @param {Date|string} [filtres.dateFin]
 * @param {string} [filtres.journal]
 */
export async function getEcrituresActives(filtres = {}) {
    const q = query(
        collection(db, 'ecritures'),
        where('statut', '==', 'active')
    );

    const snap = await getDocs(q);
    let ecritures = snap.docs.map((d) => {
        const data = d.data();
        const dateObj = data.date?.toDate ? data.date.toDate() : new Date(data.date);
        return {
            id: d.id,
            ...data,
            dateObj,
            dateStr: isNaN(dateObj.getTime()) ? '' : dateObj.toISOString().split('T')[0],
        };
    });

    // Tri chronologique
    ecritures.sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime());

    // Filtrage en mémoire
    if (filtres.dateDebut) {
        const dMin = new Date(filtres.dateDebut);
        dMin.setHours(0, 0, 0, 0);
        ecritures = ecritures.filter((e) => e.dateObj >= dMin);
    }
    if (filtres.dateFin) {
        const dMax = new Date(filtres.dateFin);
        dMax.setHours(23, 59, 59, 999);
        ecritures = ecritures.filter((e) => e.dateObj <= dMax);
    }
    if (filtres.journal) {
        ecritures = ecritures.filter((e) => e.journal === filtres.journal);
    }

    return ecritures;
}

// ─── GRAND LIVRE ─────────────────────────────────────────────────────────────

/**
 * Calcule le Grand Livre complet à partir d'une liste d'écritures.
 * Groupe par numéro de compte avec solde progressif pour chaque mouvement.
 */
export function calculerGrandLivre(ecritures) {
    const comptesMap = new Map();

    ecritures.forEach((ecriture) => {
        (ecriture.mouvements ?? []).forEach((mvt) => {
            const num = String(mvt.compte).trim();
            if (!comptesMap.has(num)) {
                comptesMap.set(num, {
                    compte: num,
                    intitule: getLibelleCompte(num),
                    totalDebit: 0,
                    totalCredit: 0,
                    lignes: [],
                });
            }
            const cData = comptesMap.get(num);
            const debit = +(mvt.debit ?? 0);
            const credit = +(mvt.credit ?? 0);

            cData.totalDebit = +(cData.totalDebit + debit).toFixed(2);
            cData.totalCredit = +(cData.totalCredit + credit).toFixed(2);

            // Différence débit - crédit
            const diffDebitMoinsCredit = +(cData.totalDebit - cData.totalCredit).toFixed(2);

            cData.lignes.push({
                ecritureId: ecriture.id,
                date: ecriture.dateObj,
                journal: ecriture.journal,
                pieceRef: ecriture.pieceRef ?? ecriture.id.slice(0, 6),
                libelle: mvt.libelle || ecriture.libelle,
                debit,
                credit,
                soldeProgressif: diffDebitMoinsCredit,
            });
        });
    });

    // Convertir en tableau trié par code compte
    const grandLivre = Array.from(comptesMap.values()).sort((a, b) => a.compte.localeCompare(b.compte, undefined, { numeric: true }));

    grandLivre.forEach((compte) => {
        compte.soldeDebiteur = compte.totalDebit > compte.totalCredit ? +(compte.totalDebit - compte.totalCredit).toFixed(2) : 0;
        compte.soldeCrediteur = compte.totalCredit > compte.totalDebit ? +(compte.totalCredit - compte.totalDebit).toFixed(2) : 0;
    });

    return grandLivre;
}

// ─── BALANCE GÉNÉRALE (6 colonnes) ──────────────────────────────────────────

/**
 * Calcule la Balance Générale à 6 colonnes :
 * 1. N° Compte
 * 2. Intitulé
 * 3. Total Débits
 * 4. Total Crédits
 * 5. Solde Débiteur
 * 6. Solde Créditeur
 */
export function calculerBalance(ecritures) {
    const gl = calculerGrandLivre(ecritures);

    let totalDebit = 0;
    let totalCredit = 0;
    let totalSoldeDebiteur = 0;
    let totalSoldeCrediteur = 0;

    const lignes = gl.map((c) => {
        totalDebit += c.totalDebit;
        totalCredit += c.totalCredit;
        totalSoldeDebiteur += c.soldeDebiteur;
        totalSoldeCrediteur += c.soldeCrediteur;

        return {
            compte: c.compte,
            intitule: c.intitule,
            totalDebit: c.totalDebit,
            totalCredit: c.totalCredit,
            soldeDebiteur: c.soldeDebiteur,
            soldeCrediteur: c.soldeCrediteur,
        };
    });

    totalDebit = +totalDebit.toFixed(2);
    totalCredit = +totalCredit.toFixed(2);
    totalSoldeDebiteur = +totalSoldeDebiteur.toFixed(2);
    totalSoldeCrediteur = +totalSoldeCrediteur.toFixed(2);

    const equilibreMouvements = Math.abs(totalDebit - totalCredit) < 0.01;
    const equilibreSoldes = Math.abs(totalSoldeDebiteur - totalSoldeCrediteur) < 0.01;

    return {
        lignes,
        totaux: {
            totalDebit,
            totalCredit,
            totalSoldeDebiteur,
            totalSoldeCrediteur,
            equilibre: equilibreMouvements && equilibreSoldes,
            ecartMouvements: +(totalDebit - totalCredit).toFixed(2),
            ecartSoldes: +(totalSoldeDebiteur - totalSoldeCrediteur).toFixed(2),
        },
    };
}

// ─── COMPTE DE RÉSULTAT ─────────────────────────────────────────────────────

/**
 * Calcule le Compte de Résultat (Produits & Charges) et les SIG (Soldes Intermédiaires de Gestion).
 */
export function calculerCompteResultat(ecritures) {
    const gl = calculerGrandLivre(ecritures);

    // Filtrer les comptes de classe 6 et 7
    const chargesLignes = [];
    const produitsLignes = [];

    gl.forEach((c) => {
        const c1 = c.compte.charAt(0);
        if (c1 === '6') {
            // Pour les charges, le montant normal est Débit - Crédit
            const montant = +(c.totalDebit - c.totalCredit).toFixed(2);
            chargesLignes.push({ ...c, montant });
        } else if (c1 === '7') {
            // Pour les produits, le montant normal est Crédit - Débit
            const montant = +(c.totalCredit - c.totalDebit).toFixed(2);
            produitsLignes.push({ ...c, montant });
        }
    });

    // Catégorisation des charges
    const chargesExploitation = chargesLignes.filter((c) => !c.compte.startsWith('66') && !c.compte.startsWith('67') && !c.compte.startsWith('68'));
    const chargesFinancieres = chargesLignes.filter((c) => c.compte.startsWith('66'));
    const chargesExceptionnelles = chargesLignes.filter((c) => c.compte.startsWith('67'));
    const dotationsAmortissements = chargesLignes.filter((c) => c.compte.startsWith('68'));

    // Catégorisation des produits
    const produitsExploitation = produitsLignes.filter((c) => !c.compte.startsWith('76') && !c.compte.startsWith('77'));
    const produitsFinanciers = produitsLignes.filter((c) => c.compte.startsWith('76'));
    const produitsExceptionnels = produitsLignes.filter((c) => c.compte.startsWith('77'));

    // Sous-totaux
    const totalChargesExploitation = +chargesExploitation.reduce((s, c) => s + c.montant, 0).toFixed(2);
    const totalChargesFinancieres = +chargesFinancieres.reduce((s, c) => s + c.montant, 0).toFixed(2);
    const totalChargesExceptionnelles = +chargesExceptionnelles.reduce((s, c) => s + c.montant, 0).toFixed(2);
    const totalDotations = +dotationsAmortissements.reduce((s, c) => s + c.montant, 0).toFixed(2);
    const totalCharges = +(totalChargesExploitation + totalChargesFinancieres + totalChargesExceptionnelles + totalDotations).toFixed(2);

    const totalProduitsExploitation = +produitsExploitation.reduce((s, c) => s + c.montant, 0).toFixed(2);
    const totalProduitsFinanciers = +produitsFinanciers.reduce((s, c) => s + c.montant, 0).toFixed(2);
    const totalProduitsExceptionnels = +produitsExceptionnels.reduce((s, c) => s + c.montant, 0).toFixed(2);
    const totalProduits = +(totalProduitsExploitation + totalProduitsFinanciers + totalProduitsExceptionnels).toFixed(2);

    // Soldes de gestion
    const resultatExploitation = +(totalProduitsExploitation - (totalChargesExploitation + totalDotations)).toFixed(2);
    const resultatFinancier = +(totalProduitsFinanciers - totalChargesFinancieres).toFixed(2);
    const resultatCourant = +(resultatExploitation + resultatFinancier).toFixed(2);
    const resultatExceptionnel = +(totalProduitsExceptionnels - totalChargesExceptionnelles).toFixed(2);
    const resultatNet = +(totalProduits - totalCharges).toFixed(2);

    return {
        charges: {
            exploitation: chargesExploitation,
            financieres: chargesFinancieres,
            exceptionnelles: chargesExceptionnelles,
            dotations: dotationsAmortissements,
            totalExploitation: totalChargesExploitation,
            totalFinancieres: totalChargesFinancieres,
            totalExceptionnelles: totalChargesExceptionnelles,
            totalDotations: totalDotations,
            totalGlobal: totalCharges,
        },
        produits: {
            exploitation: produitsExploitation,
            financiers: produitsFinanciers,
            exceptionnels: produitsExceptionnels,
            totalExploitation: totalProduitsExploitation,
            totalFinanciers: totalProduitsFinanciers,
            totalExceptionnels: totalProduitsExceptionnels,
            totalGlobal: totalProduits,
        },
        sig: {
            resultatExploitation,
            resultatFinancier,
            resultatCourant,
            resultatExceptionnel,
            resultatNet,
            estBenefice: resultatNet >= 0,
        },
    };
}

// ─── BILAN COMPTABLE ────────────────────────────────────────────────────────

/**
 * Calcule le Bilan (Actif & Passif).
 * Intègre automatiquement le Résultat Net de l'exercice dans les capitaux propres.
 */
export function calculerBilan(ecritures) {
    const gl = calculerGrandLivre(ecritures);
    const cr = calculerCompteResultat(ecritures);
    const resultatNet = cr.sig.resultatNet;

    // ── ACTIF ──
    const actifImmo = [];          // Classe 2 (solde débiteur)
    const actifStocks = [];        // Classe 3
    const actifCreancesClients = []; // 411... (solde débiteur)
    const actifAutresCreances = [];  // Autres classe 4 avec solde débiteur (hors 411)
    const actifDisponibilites = [];  // Classe 5 (solde débiteur)

    // ── PASSIF ──
    const passifCapitauxPropres = []; // Classe 1 (101, 106, 110/119)
    const passifDettesFinancieresCCA = []; // 16x et 455x (CCA créditeurs)
    const passifDettesFournisseurs = [];   // 401... (solde créditeur)
    const passifDettesFiscalesSociales = []; // 42, 43, 44... (solde créditeur)
    const passifAutresDettes = [];         // Autres dettes

    gl.forEach((c) => {
        const num = c.compte;
        const c1 = num.charAt(0);
        const soldeNet = +(c.totalDebit - c.totalCredit).toFixed(2);

        // Classe 2 : Immobilisations
        if (c1 === '2') {
            if (num.startsWith('28')) {
                actifImmo.push({ ...c, montant: -Math.abs(c.totalCredit - c.totalDebit) });
            } else {
                actifImmo.push({ ...c, montant: soldeNet });
            }
        }
        // Classe 3 : Stocks
        else if (c1 === '3') {
            actifStocks.push({ ...c, montant: soldeNet });
        }
        // Classe 5 : Trésorerie
        else if (c1 === '5') {
            if (soldeNet >= 0) {
                actifDisponibilites.push({ ...c, montant: soldeNet });
            } else {
                passifDettesFinancieresCCA.push({ ...c, montant: Math.abs(soldeNet) });
            }
        }
        // Classe 1 : Capitaux
        else if (c1 === '1') {
            const soldePassif = +(c.totalCredit - c.totalDebit).toFixed(2);
            if (num.startsWith('16')) {
                passifDettesFinancieresCCA.push({ ...c, montant: soldePassif });
            } else {
                passifCapitauxPropres.push({ ...c, montant: soldePassif });
            }
        }
        // Classe 4 : Tiers
        else if (c1 === '4') {
            if (num.startsWith('455')) {
                // Compte Courant d'Associé
                const soldeCCA = +(c.totalCredit - c.totalDebit).toFixed(2);
                if (soldeCCA >= 0) {
                    passifDettesFinancieresCCA.push({ ...c, montant: soldeCCA, isCCA: true });
                } else {
                    actifAutresCreances.push({ ...c, montant: Math.abs(soldeCCA), isCCADebiteur: true });
                }
            } else if (num.startsWith('41')) {
                if (soldeNet >= 0) {
                    actifCreancesClients.push({ ...c, montant: soldeNet });
                } else {
                    passifAutresDettes.push({ ...c, montant: Math.abs(soldeNet) });
                }
            } else if (num.startsWith('40')) {
                const soldeFourn = +(c.totalCredit - c.totalDebit).toFixed(2);
                if (soldeFourn >= 0) {
                    passifDettesFournisseurs.push({ ...c, montant: soldeFourn });
                } else {
                    actifAutresCreances.push({ ...c, montant: Math.abs(soldeFourn) });
                }
            } else if (num.startsWith('42') || num.startsWith('43') || num.startsWith('44') || num.startsWith('457')) {
                const soldeFisc = +(c.totalCredit - c.totalDebit).toFixed(2);
                if (soldeFisc >= 0) {
                    passifDettesFiscalesSociales.push({ ...c, montant: soldeFisc });
                } else {
                    actifAutresCreances.push({ ...c, montant: Math.abs(soldeFisc) });
                }
            } else {
                if (soldeNet >= 0) {
                    actifAutresCreances.push({ ...c, montant: soldeNet });
                } else {
                    passifAutresDettes.push({ ...c, montant: Math.abs(soldeNet) });
                }
            }
        }
    });

    // Totaux Actif
    const totalImmo = +actifImmo.reduce((s, c) => s + c.montant, 0).toFixed(2);
    const totalStocks = +actifStocks.reduce((s, c) => s + c.montant, 0).toFixed(2);
    const totalClients = +actifCreancesClients.reduce((s, c) => s + c.montant, 0).toFixed(2);
    const totalAutresCreances = +actifAutresCreances.reduce((s, c) => s + c.montant, 0).toFixed(2);
    const totalDispo = +actifDisponibilites.reduce((s, c) => s + c.montant, 0).toFixed(2);

    const totalActifImmobilise = totalImmo;
    const totalActifCirculant = +(totalStocks + totalClients + totalAutresCreances + totalDispo).toFixed(2);
    const totalActif = +(totalActifImmobilise + totalActifCirculant).toFixed(2);

    // Totaux Passif
    const totalCapitauxHorsResultat = +passifCapitauxPropres.reduce((s, c) => s + c.montant, 0).toFixed(2);
    const totalCapitauxPropres = +(totalCapitauxHorsResultat + resultatNet).toFixed(2);

    const totalDettesFinancieresCCA = +passifDettesFinancieresCCA.reduce((s, c) => s + c.montant, 0).toFixed(2);
    const totalDettesFournisseurs = +passifDettesFournisseurs.reduce((s, c) => s + c.montant, 0).toFixed(2);
    const totalDettesFiscalesSociales = +passifDettesFiscalesSociales.reduce((s, c) => s + c.montant, 0).toFixed(2);
    const totalAutresDettes = +passifAutresDettes.reduce((s, c) => s + c.montant, 0).toFixed(2);

    const totalDettes = +(totalDettesFinancieresCCA + totalDettesFournisseurs + totalDettesFiscalesSociales + totalAutresDettes).toFixed(2);
    const totalPassif = +(totalCapitauxPropres + totalDettes).toFixed(2);

    const ecartBilan = +(totalActif - totalPassif).toFixed(2);
    const estEquilibre = Math.abs(ecartBilan) < 0.01;

    return {
        actif: {
            immobilisations: actifImmo,
            stocks: actifStocks,
            clients: actifCreancesClients,
            autresCreances: actifAutresCreances,
            disponibilites: actifDisponibilites,
            totalImmobilise: totalActifImmobilise,
            totalCirculant: totalActifCirculant,
            totalDispo,
            total: totalActif,
        },
        passif: {
            capitauxPropres: passifCapitauxPropres,
            resultatNet,
            totalCapitauxPropres,
            dettesFinancieresCCA: passifDettesFinancieresCCA,
            dettesFournisseurs: passifDettesFournisseurs,
            dettesFiscalesSociales: passifDettesFiscalesSociales,
            autresDettes: passifAutresDettes,
            totalDettes,
            total: totalPassif,
        },
        equilibre: {
            estEquilibre,
            ecart: ecartBilan,
        },
    };
}

// ─── EXPORT DU FICHIER DES ÉCRITURES COMPTABLES (FEC) ───────────────────────

/**
 * Génère le fichier texte tabulé conforme à la norme légale française
 * Article A.47 A-1 du Livre des Procédures Fiscales (LPF).
 */
export function genererFEC(ecritures, siren = '000000000', annee = new Date().getFullYear()) {
    const HEADERS = [
        'JournalCode',
        'JournalLib',
        'EcritureNum',
        'EcritureDate',
        'CompteNum',
        'CompteLib',
        'CompAuxNum',
        'CompAuxLib',
        'PieceRef',
        'PieceDate',
        'EcritureLib',
        'Debit',
        'Credit',
        'EcritureLet',
        'DateLet',
        'ValidDate',
        'Montantdevise',
        'Idevise',
    ];

    const NOMS_JOURNAUX = {
        VE: 'Journal des Ventes',
        AC: 'Journal des Achats',
        BQ: 'Journal de Banque',
        OD: 'Journal des Opérations Diverses',
    };

    const lines = [HEADERS.join('\t')];
    let seqEcriture = 1;

    ecritures.forEach((ecriture) => {
        const d = ecriture.dateObj;
        const dateAAAAMMJJ = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
        const journalCode = ecriture.journal || 'OD';
        const journalLib = NOMS_JOURNAUX[journalCode] || journalCode;
        const pieceRef = ecriture.pieceRef || ecriture.id.slice(0, 8);
        const ecritureNum = `ECR-${seqEcriture}`;
        seqEcriture++;

        (ecriture.mouvements ?? []).forEach((mvt) => {
            const compteNum = String(mvt.compte).trim();
            const compteLib = getLibelleCompte(compteNum);
            const debit = mvt.debit ? (+mvt.debit).toFixed(2).replace('.', ',') : '0,00';
            const credit = mvt.credit ? (+mvt.credit).toFixed(2).replace('.', ',') : '0,00';
            const ecritureLib = (mvt.libelle || ecriture.libelle || 'Ecriture comptable').replace(/[\r\n\t]/g, ' ');

            const row = [
                journalCode,
                journalLib,
                ecritureNum,
                dateAAAAMMJJ,
                compteNum,
                compteLib,
                '', // CompAuxNum
                '', // CompAuxLib
                pieceRef,
                dateAAAAMMJJ,
                ecritureLib,
                debit,
                credit,
                '', // Lettrage
                '', // DateLet
                dateAAAAMMJJ, // ValidDate
                '', // Montantdevise
                '', // Idevise
            ];

            lines.push(row.join('\t'));
        });
    });

    const content = lines.join('\r\n');
    const filename = `${siren}FEC${annee}1231.txt`;

    return { content, filename };
}

/**
 * Télécharge un fichier texte ou CSV côté navigateur.
 */
export function telechargerFichier(contenu, nomFichier, mime = 'text/plain;charset=utf-8') {
    const blob = new Blob([contenu], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nomFichier;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
