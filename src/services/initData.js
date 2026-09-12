import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

// Catégories de dépenses par défaut (une seule initialisation au premier démarrage)
const DEFAULT_CATEGORIES = [
    {
        id: 'repas',
        label: "Repas d'affaires",
        compte: '6257',
        motifObligatoire: true,
        infoFiscale: "Déductible si le motif professionnel est clairement indiqué (réunion avec un client, un partenaire, ou entre associés). À conserver avec le justificatif.",
        ordre: 1,
    },
    {
        id: 'fournitures',
        label: 'Courses / fournitures équipe',
        compte: '6068',
        motifObligatoire: false,
        infoFiscale: "Matières consommables et petites fournitures utilisées par l'équipe (café, papeterie, etc.).",
        ordre: 2,
    },
    {
        id: 'materiel',
        label: 'Matériel & équipement',
        compte: '6068',
        motifObligatoire: false,
        infoFiscale: "Matériel passé directement en charge (pas d'immobilisation ni d'amortissement pour l'instant).",
        ordre: 3,
    },
    {
        id: 'abonnements',
        label: 'Abonnements & services numériques',
        compte: '6135',
        motifObligatoire: false,
        infoFiscale: "Tous les services numériques : logiciels SaaS, hébergement, noms de domaine, API, Firebase, Google Cloud, etc.",
        ordre: 4,
    },
    {
        id: 'cadeaux',
        label: 'Cadeaux clients',
        compte: '6234',
        motifObligatoire: false,
        infoFiscale: "⚠️ La déductibilité des cadeaux clients est plafonnée fiscalement (69 € TTC par bénéficiaire et par an). Au-delà du plafond, la TVA n'est pas récupérable.",
        ordre: 5,
    },
];

const DEFAULT_SETTINGS = {
    statutTVA: 'franchise',   // franchise en base par défaut
    tauxTVADefaut: 20,
    journaux: {
        ventes: 'VE',
        achats: 'AC',
        banque: 'BQ',
        od: 'OD',
    },
};

/**
 * Initialise les données par défaut en base si elles n'existent pas encore.
 * À appeler une fois au démarrage de l'app (ex. dans App.jsx).
 */
export async function initDefaultData() {
    // Settings
    const settingsRef = doc(db, 'settings', 'config');
    const settingsSnap = await getDoc(settingsRef);
    if (!settingsSnap.exists()) {
        await setDoc(settingsRef, { ...DEFAULT_SETTINGS, updatedAt: serverTimestamp() });
    }

    // Catégories — parallèle pour éviter 5 allers-retours séquentiels
    await Promise.all(
        DEFAULT_CATEGORIES.map(async (cat) => {
            const catRef = doc(db, 'categoriesDepense', cat.id);
            const catSnap = await getDoc(catRef);
            if (!catSnap.exists()) {
                await setDoc(catRef, { ...cat, createdAt: serverTimestamp() });
            }
        })
    );
}

/**
 * Lit le document settings/config depuis Firestore.
 */
export async function getSettings() {
    const snap = await getDoc(doc(db, 'settings', 'config'));
    return snap.exists() ? snap.data() : DEFAULT_SETTINGS;
}
