/**
 * crmGestionnairesService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Service de gestion de la liste personnalisable des gestionnaires de contacts / clients.
 * Stocké dans Firestore : doc(db, 'settings', 'crm_gestionnaires')
 */
import { doc, getDoc, setDoc, getDocs, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { getCached, setCached } from './dataCache';

const CACHE_KEY = 'crm_gestionnaires';
const LOCAL_STORAGE_KEY = 'crm_gestionnaires_persisted';
const DEFAULT_GESTIONNAIRES = ['Antoine', 'Thomas'];

function getFromLocalStorage() {
    try {
        const item = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (item) {
            const parsed = JSON.parse(item);
            if (Array.isArray(parsed?.list) && parsed.list.length > 0) {
                return parsed;
            }
        }
    } catch { }
    return null;
}

/**
 * Récupère la liste unifiée des gestionnaires.
 * Si l'utilisateur a personnalisé son équipe, sa liste est strictement respectée sans réinjection automatique d'associés supprimés.
 */
export async function getUnifiedGestionnaires() {
    try {
        const customGests = await getGestionnaires();
        const local = getFromLocalStorage();
        
        // Si l'équipe a été personnalisée explicitement, on respecte la liste exacte
        if (local?.isCustomized || (customGests && customGests._isCustomized)) {
            return customGests.map ? customGests.filter(Boolean) : customGests;
        }

        // Sinon, première initialisation : combiner liste par défaut et associés actifs
        const associesSnap = await getDocs(collection(db, 'associes')).catch(() => ({ docs: [] }));
        const set = new Set([...(customGests || DEFAULT_GESTIONNAIRES)]);
        if (associesSnap && associesSnap.docs) {
            associesSnap.docs.forEach((d) => {
                const a = d.data();
                if (a.actif !== false) {
                    const name = `${a.prenom || ''} ${a.nom || ''}`.trim();
                    if (name) set.add(name);
                }
            });
        }
        return Array.from(set);
    } catch (err) {
        console.error('Erreur récupération gestionnaires unifiés:', err);
        return getGestionnaires();
    }
}

/**
 * Récupère la liste des gestionnaires (mémoire -> localStorage -> Firestore)
 */
export async function getGestionnaires() {
    const cached = getCached(CACHE_KEY);
    if (cached && Array.isArray(cached) && cached.length > 0) return cached;

    // Vérifier localStorage (fiable même en localhost / hors ligne)
    const local = getFromLocalStorage();
    if (local?.list && Array.isArray(local.list) && local.list.length > 0) {
        setCached(CACHE_KEY, local.list);
    }

    try {
        const snap = await getDoc(doc(db, 'settings', 'crm_gestionnaires'));
        if (snap.exists() && Array.isArray(snap.data().list) && snap.data().list.length > 0) {
            const list = snap.data().list;
            const isCustomized = snap.data().isCustomized ?? true;
            try {
                localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({ list, isCustomized }));
            } catch { }
            setCached(CACHE_KEY, list);
            return list;
        }

        if (local?.list) return local.list;

        // Si inexistant, initialiser avec la liste par défaut
        try {
            await setDoc(doc(db, 'settings', 'crm_gestionnaires'), {
                list: DEFAULT_GESTIONNAIRES,
                isCustomized: false,
                updatedAt: serverTimestamp(),
            });
        } catch { }

        setCached(CACHE_KEY, DEFAULT_GESTIONNAIRES);
        return DEFAULT_GESTIONNAIRES;
    } catch (err) {
        console.warn('Erreur Firestore récupération gestionnaires (utilisation fallback local):', err);
        return local?.list || DEFAULT_GESTIONNAIRES;
    }
}

/**
 * Sauvegarde la liste des gestionnaires (localStorage immédiat + Firestore)
 */
export async function saveGestionnaires(list) {
    const cleaned = Array.isArray(list) ? list.map((x) => String(x).trim()).filter(Boolean) : [];
    
    // 1. Sauvegarde synchrone immédiate dans le cache et localStorage
    setCached(CACHE_KEY, cleaned);
    try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({
            list: cleaned,
            isCustomized: true,
            updatedAt: new Date().toISOString(),
        }));
    } catch (e) {
        console.warn('Erreur écriture localStorage gestionnaires:', e);
    }

    // 2. Sauvegarde dans Firestore (sans bloquer si le serveur distant est en localhost/permission issue)
    try {
        await setDoc(doc(db, 'settings', 'crm_gestionnaires'), {
            list: cleaned,
            isCustomized: true,
            updatedAt: serverTimestamp(),
        });
        return true;
    } catch (err) {
        console.warn('Erreur Firestore sauvegarde gestionnaires (sauvegarde locale validée):', err);
        return true;
    }
}
