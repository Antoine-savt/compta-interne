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
        infoFiscale: "TVA récupérable seulement si le cadeau vaut 73 € TTC maximum par bénéficiaire et par an. Pour l'impôt sur les sociétés, les cadeaux restent déductibles s'ils sont dans l'intérêt de l'entreprise ; au-delà de 3 000 € par an, ils doivent être déclarés (relevé des frais généraux).",
        ordre: 5,
    },
];

const DEFAULT_SETTINGS = {
    statutTVA: 'franchise',   // franchise en base par défaut
    tauxTVADefaut: 20,
    journaux: {
        ventes: 'VT',
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
