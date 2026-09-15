/**
 * FicheClient.jsx
 * Fiche client complète spécialisée pour la gestion des clients et sites internet.
 * - Coordonnées complètes & informations légales (SIRET, TVA)
 * - Données du site internet (URL, statut, type, stack, hébergeur, dates de mise en ligne et renouvellement)
 * - Suivi du prochain rendez-vous (date, heure, objet, visio, actions rapides)
 * - Tâches et to-do list en cours
 * - Journal chronologique des échanges et comptes-rendus
 * - Historique comptable réel (factures, dépenses rattachées, marge brute)
 * 
 * Contrainte stricte : AUCUN EMOJI. Design sobre, clair et haute densité d'information.
 */
import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
    doc, getDoc, getDocs, collection, query, where,
    orderBy, updateDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { ecrireEcriture } from '../services/api';
import { formatMontant, formatDate, toISODate } from '../services/helpers';
import { getCached, setCached, invalidateCache } from '../services/dataCache';
import ModalCreateRdv from '../components/agenda/ModalCreateRdv';
import { DateInput } from '../components/common/DateInput';
import { getRendezVousList, createRendezVous, calculateEndTime } from '../services/rdvService';

function Spinner() {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-muted)', padding: '40px 0' }}>
            <div style={{
                width: 20, height: 20, borderRadius: '50%',
                border: '2px solid var(--border)',
                borderTopColor: 'var(--accent)',
                animation: 'spin 0.7s linear infinite',
                flexShrink: 0,
            }} />
            Chargement de la fiche client...
        </div>
    );
}

// Formats de rendez-vous
const RDV_FORMATS = [
    { id: 'visio', label: 'Visioconférence' },
    { id: 'telephone', label: 'Appel téléphonique' },
    { id: 'presentiel', label: 'Présentiel' },
];

// Statuts du site internet
const SITE_STATUTS = [
    { id: 'en_ligne', label: 'En ligne', cls: 'status-tag--online' },
    { id: 'en_dev', label: 'En développement', cls: 'status-tag--dev' },
    { id: 'en_recette', label: 'En recette / test', cls: 'status-tag--recette' },
    { id: 'en_refonte', label: 'En refonte', cls: 'status-tag--refonte' },
    { id: 'maintenance', label: 'En maintenance', cls: 'status-tag--maint' },
    { id: 'hors_ligne', label: 'Hors ligne', cls: 'status-tag--offline' },
];

// Types de site internet
const SITE_TYPES = [
    { id: 'vitrine', label: 'Site vitrine' },
    { id: 'ecommerce', label: 'Boutique e-commerce' },
    { id: 'webapp', label: 'Application web' },
    { id: 'landing_page', label: 'Landing page' },
    { id: 'sur_mesure', label: 'Sur-mesure' },
];

// Statuts client
const CLIENT_STATUTS = [
    { id: 'client_actif', label: 'Client actif', cls: 'badge--success' },
    { id: 'projet_en_cours', label: 'Projet en cours', cls: 'badge--info' },
    { id: 'prospect', label: 'Prospect', cls: 'badge--warning' },
    { id: 'client_inactif', label: 'Client inactif', cls: 'badge--muted' },
    { id: 'archive', label: 'Archivé', cls: 'badge--muted' },
];

export default function FicheClient() {
    const { clientId } = useParams();
    const navigate = useNavigate();

    const [client, setClient] = useState(() => {
        const cached = getCached('clients');
        return cached?.find((c) => c.id === clientId) || null;
    });
    const [categories, setCategories] = useState(() => getCached('categoriesClient') || []);
    const [factures, setFactures] = useState([]);
    const [facturations, setFacturations] = useState([]);
    const [depenses, setDepenses] = useState([]);
    const [versementsStripe, setVersementsStripe] = useState([]);
    const [loading, setLoading] = useState(() => {
        const cached = getCached('clients');
        return !cached?.some((c) => c.id === clientId);
    });

    // Données complètes pour modales de rattachement
    const [allDepenses, setAllDepenses] = useState([]);
    const [allFactures, setAllFactures] = useState([]);
    const [allFacturations, setAllFacturations] = useState([]);
    const [showAttachDepenseModal, setShowAttachDepenseModal] = useState(false);
    const [showAttachRecetteModal, setShowAttachRecetteModal] = useState(false);

    // Modes d'affichage
    const [edit, setEdit] = useState(false);
    const [editForm, setEditForm] = useState({});
    const [saving, setSaving] = useState(false);

    // Modals RDV & Échanges
    const [allRdvs, setAllRdvs] = useState([]);
    const [showRdvModal, setShowRdvModal] = useState(false);
    const [rdvForm, setRdvForm] = useState({
        date: '',
        heure: '14:00',
        format: 'visio',
        objet: '',
        lien: '',
    });

    const [showFinishRdvModal, setShowFinishRdvModal] = useState(false);
    const [finishRdvNotes, setFinishRdvNotes] = useState('');

    const [showAddExchange, setShowAddExchange] = useState(false);
    const [exchangeForm, setExchangeForm] = useState({
        date: toISODate(new Date()),
        titre: '',
        format: 'visio',
        contenu: '',
    });

    // Nouvelle tâche rapide
    const [newTodoText, setNewTodoText] = useState('');

    useEffect(() => {
        async function loadData() {
            try {
                const [cliSnap, catSnap, factSnap, facturationSnap, depSnap, versSnap] = await Promise.all([
                    getDoc(doc(db, 'clients', clientId)),
                    getDocs(query(collection(db, 'categoriesClient'), orderBy('ordre'))),
                    getDocs(collection(db, 'factures')),
                    getDocs(collection(db, 'facturations')),
                    getDocs(collection(db, 'depenses')),
                    getDocs(collection(db, 'versementsStripe')),
                ]);

                if (!cliSnap.exists()) {
                    navigate('/clients');
                    return;
                }

                const cliData = { id: cliSnap.id, ...cliSnap.data() };
                setClient(cliData);
                setEditForm(cliData);

                const cats = catSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
                setCategories(cats);
                setCached('categoriesClient', cats);

                // Factures légales
                const facList = factSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
                setAllFactures(facList);
                setFactures(facList.filter((f) => f.clientId === clientId).sort((a, b) => {
                    const da = a.dateFacture?.toDate ? a.dateFacture.toDate() : new Date(a.dateFacture || a.createdAt?.toDate?.() || 0);
                    const dbDate = b.dateFacture?.toDate ? b.dateFacture.toDate() : new Date(b.dateFacture || b.createdAt?.toDate?.() || 0);
                    return dbDate - da;
                }));

                // Facturations
                const factuList = facturationSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
                setAllFacturations(factuList);
                setFacturations(factuList.filter((f) => f.clientId === clientId).sort((a, b) => {
                    const da = a.date?.toDate ? a.date.toDate() : new Date(a.date || a.createdAt?.toDate?.() || 0);
                    const dbDate = b.date?.toDate ? b.date.toDate() : new Date(b.date || b.createdAt?.toDate?.() || 0);
                    return dbDate - da;
                }));

                // Dépenses analytiques
                const depListAll = depSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
                setAllDepenses(depListAll);
                const depListClient = depListAll.filter(
                    (d) => d.clientProjetId === clientId || d.clientId === clientId || (cliData.nom && d.clientProjetNom === cliData.nom)
                ).sort((a, b) => {
                    const da = a.dateDépense?.toDate ? a.dateDépense.toDate() : new Date(a.dateDépense || a.createdAt?.toDate?.() || 0);
                    const dbDate = b.dateDépense?.toDate ? b.dateDépense.toDate() : new Date(b.dateDépense || b.createdAt?.toDate?.() || 0);
                    return dbDate - da;
                });
                setDepenses(depListClient);

                // Versements Stripe
                const versList = versSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
                setVersementsStripe(versList.filter((v) => v.clientId === clientId));
            } catch (err) {
                console.error('Erreur chargement fiche client:', err);
            } finally {
                setLoading(false);
            }
        }
        loadData();
        getRendezVousList().then((list) => {
            if (Array.isArray(list)) setAllRdvs(list);
        });
    }, [clientId, navigate]);

    // ─── Actions de rattachement / détachement de dépenses ─────────────────────
    async function handleRattacherDepense(depId) {
        const nom = client?.nom || 'Client';
        setDepenses((prev) => {
            const found = allDepenses.find((d) => d.id === depId);
            if (!found) return prev;
            return [{ ...found, clientProjetId: clientId, clientProjetNom: nom, clientId, clientNom: nom }, ...prev.filter((d) => d.id !== depId)];
        });
        setAllDepenses((prev) =>
            prev.map((d) => (d.id === depId ? { ...d, clientProjetId: clientId, clientProjetNom: nom, clientId, clientNom: nom } : d))
        );
        invalidateCache('depenses');
        invalidateCache('clients');

        try {
            await updateDoc(doc(db, 'depenses', depId), {
                clientProjetId: clientId,
                clientProjetNom: nom,
                clientId: clientId,
                clientNom: nom,
                updatedAt: serverTimestamp(),
            });
        } catch (err) {
            console.error('Erreur rattachement dépense:', err);
        }
    }

    async function handleDetacherDepense(depId) {
        setDepenses((prev) => prev.filter((d) => d.id !== depId));
        setAllDepenses((prev) =>
            prev.map((d) => (d.id === depId ? { ...d, clientProjetId: null, clientProjetNom: null, clientId: null, clientNom: null } : d))
        );
        invalidateCache('depenses');
        invalidateCache('clients');

        try {
            await updateDoc(doc(db, 'depenses', depId), {
                clientProjetId: null,
                clientProjetNom: null,
                clientId: null,
                clientNom: null,
                updatedAt: serverTimestamp(),
            });
        } catch (err) {
            console.error('Erreur détachement dépense:', err);
        }
    }

    // ─── Actions de rattachement / détachement de recettes / factures ──────────
    async function handleRattacherRecette(item, type) {
        const nom = client?.nom || 'Client';
        const collName = type === 'facturation' ? 'facturations' : 'factures';
        if (type === 'facturation') {
            setFacturations((prev) => [{ ...item, clientId, clientNom: nom }, ...prev.filter((f) => f.id !== item.id)]);
            setAllFacturations((prev) => prev.map((f) => (f.id === item.id ? { ...f, clientId, clientNom: nom } : f)));
        } else {
            setFactures((prev) => [{ ...item, clientId, clientNom: nom }, ...prev.filter((f) => f.id !== item.id)]);
            setAllFactures((prev) => prev.map((f) => (f.id === item.id ? { ...f, clientId, clientNom: nom } : f)));
        }
        invalidateCache('clients');

        try {
            await updateDoc(doc(db, collName, item.id), {
                clientId,
                clientNom: nom,
                updatedAt: serverTimestamp(),
            });
        } catch (err) {
            console.error('Erreur rattachement recette:', err);
        }
    }

    async function handleDetacherRecette(item, type) {
        const collName = type === 'facturation' ? 'facturations' : 'factures';
        if (type === 'facturation') {
            setFacturations((prev) => prev.filter((f) => f.id !== item.id));
            setAllFacturations((prev) => prev.map((f) => (f.id === item.id ? { ...f, clientId: null, clientNom: null } : f)));
        } else {
            setFactures((prev) => prev.filter((f) => f.id !== item.id));
            setAllFactures((prev) => prev.map((f) => (f.id === item.id ? { ...f, clientId: null, clientNom: null } : f)));
        }
        invalidateCache('clients');

        try {
            await updateDoc(doc(db, collName, item.id), {
                clientId: null,
                clientNom: null,
                updatedAt: serverTimestamp(),
            });
        } catch (err) {
            console.error('Erreur détachement recette:', err);
        }
    }

    // ─── Métriques financières ────────────────────────────────────────────────
    const totalFacturesLegalesTTC = factures.reduce((s, f) => s + (f.totalTTC ?? 0), 0);
    const totalFacturationsTTC = facturations.reduce((s, f) => s + (f.totalFacture ?? 0), 0);
    const totalFactureTTC = totalFacturesLegalesTTC + totalFacturationsTTC;

    const totalFactureHT = factures.reduce((s, f) => s + (f.totalHT ?? f.totalTTC ?? 0), 0) + totalFacturationsTTC;
    const totalEnAttenteTTC = factures
        .filter((f) => f.statut === 'en_attente')
        .reduce((s, f) => s + (f.totalTTC ?? 0), 0) +
        facturations
        .filter((f) => f.statut !== 'encaissee' && !f.withStripe)
        .reduce((s, f) => s + (f.totalFacture ?? 0), 0);
    const countEnAttente = factures.filter((f) => f.statut === 'en_attente').length + facturations.filter((f) => f.statut !== 'encaissee' && !f.withStripe).length;

    const totalDepensesTTC = depenses.reduce((s, d) => s + (d.montantTTC ?? d.montant ?? 0), 0);
    const totalEncaisseStripe = versementsStripe.reduce((s, v) => s + (v.montantBrut ?? 0), 0) +
        facturations.reduce((s, f) => s + (f.stripe?.brut ?? (f.withStripe ? f.totalFacture : 0)), 0);

    // Chiffre d'affaires global pris en compte
    const caGlobal = Math.max(totalFactureTTC, totalEncaisseStripe);
    const margeNette = caGlobal > 0 ? caGlobal - totalDepensesTTC : (totalDepensesTTC > 0 ? -totalDepensesTTC : null);
    const pourcentageMarge = caGlobal > 0 ? (margeNette / caGlobal) * 100 : (totalDepensesTTC > 0 ? -100 : null);

    const mrrFacturations = facturations.reduce((s, f) => s + (f.mrr ?? 0), 0);
    const mrr = mrrFacturations || parseFloat(client?.abonnementMensuelManuel) || 0;

    // ─── Mise à jour globale du client ─────────────────────────────────────────
    async function handleSaveEdit() {
        setSaving(true);
        try {
            const payload = {
                nom: editForm.nom?.trim() || '',
                contactPrenom: editForm.contactPrenom?.trim() || '',
                contactNom: editForm.contactNom?.trim() || '',
                contactRole: editForm.contactRole?.trim() || '',
                email: editForm.email?.trim() || '',
                telephone: editForm.telephone?.trim() || '',
                adresse: editForm.adresse?.trim() || '',
                codePostal: editForm.codePostal?.trim() || '',
                ville: editForm.ville?.trim() || '',
                siret: editForm.siret?.trim() || '',
                tvaIntra: editForm.tvaIntra?.trim() || '',

                categorieId: editForm.categorieId || null,
                categorieNom: categories.find((c) => c.id === editForm.categorieId)?.nom || null,
                statutClient: editForm.statutClient || 'client_actif',

                // Site internet
                siteUrl: editForm.siteUrl?.trim() || '',
                siteStatut: editForm.siteStatut || 'en_ligne',
                siteType: editForm.siteType || 'vitrine',
                siteStack: editForm.siteStack?.trim() || '',
                siteHebergeur: editForm.siteHebergeur?.trim() || '',
                siteDateLigne: editForm.siteDateLigne || '',
                siteDateRenouvellement: editForm.siteDateRenouvellement || '',
                notesTechniques: editForm.notesTechniques?.trim() || '',

                // Financier
                abonnementMensuelManuel: parseFloat(editForm.abonnementMensuelManuel) || 0,
                coutMensuelEstime: parseFloat(editForm.coutMensuelEstime) || 0,
                updatedAt: serverTimestamp(),
            };

            await updateDoc(doc(db, 'clients', clientId), payload);

            setClient((prev) => ({ ...prev, ...payload }));
            setEdit(false);

            // Mettre à jour le cache
            const cachedList = getCached('clients') || [];
            const nextList = cachedList.map((c) => (c.id === clientId ? { ...c, ...payload } : c));
            setCached('clients', nextList);
        } catch (err) {
            console.error('Erreur sauvegarde client:', err);
            alert('Une erreur est survenue lors de l\'enregistrement.');
        } finally {
            setSaving(false);
        }
    }

    // ─── Prochain rendez-vous : Planifier / Modifier ───────────────────────────
    function openRdvModal(isEdit = false) {
        if (isEdit && client.prochainRdvDate) {
            setRdvForm({
                date: client.prochainRdvDate || '',
                heure: client.prochainRdvHeure || '14:00',
                format: client.prochainRdvFormat || 'visio',
                objet: client.prochainRdvObjet || '',
                lien: client.prochainRdvLien || '',
            });
        } else {
            const demain = new Date();
            demain.setDate(demain.getDate() + 1);
            setRdvForm({
                date: demain.toISOString().split('T')[0],
                heure: '14:00',
                format: 'visio',
                objet: '',
                lien: '',
            });
        }
        setShowRdvModal(true);
    }

    async function handleSaveRdv() {
        if (!rdvForm.date) return;
        setSaving(true);
        try {
            const hDebut = rdvForm.heure || '14:00';
            const payload = {
                prochainRdvDate: rdvForm.date,
                prochainRdvHeure: hDebut,
                prochainRdvFormat: rdvForm.format || 'visio',
                prochainRdvObjet: rdvForm.objet.trim() || 'Point d\'étape',
                prochainRdvLien: rdvForm.lien.trim(),
                updatedAt: serverTimestamp(),
            };
            await updateDoc(doc(db, 'clients', clientId), payload);
            setClient((prev) => ({ ...prev, ...payload }));
            setShowRdvModal(false);

            // Mettre à jour cache
            const cachedList = getCached('clients') || [];
            setCached('clients', cachedList.map((c) => (c.id === clientId ? { ...c, ...payload } : c)));

            // Synchronisation avec la collection rendezvous pour affichage immédiat dans l'Agenda
            await createRendezVous({
                clientId,
                clientNom: client.nom || 'Client',
                clientContact: `${client.contactPrenom || ''} ${client.contactNom || ''}`.trim() || client.contact || '',
                clientTelephone: client.telephone || '',
                clientEmail: client.email || '',
                quiGere: client.quiGere || 'Antoine',
                date: rdvForm.date,
                heureDebut: hDebut,
                heureFin: calculateEndTime(hDebut, 30),
                dureeMinutes: 30,
                type: rdvForm.format || 'visio',
                notes: rdvForm.objet.trim() || 'Point d\'étape',
                lienVisio: rdvForm.lien.trim(),
                statut: 'planifie',
            });
        } catch (err) {
            console.error('Erreur enregistrement RDV:', err);
        } finally {
            setSaving(false);
        }
    }

    async function handleCancelRdv() {
        if (!confirm('Voulez-vous supprimer ce rendez-vous planifié ?')) return;
        setSaving(true);
        try {
            const payload = {
                prochainRdvDate: null,
                prochainRdvHeure: null,
                prochainRdvFormat: null,
                prochainRdvObjet: null,
                prochainRdvLien: null,
                updatedAt: serverTimestamp(),
            };
            await updateDoc(doc(db, 'clients', clientId), payload);
            setClient((prev) => ({ ...prev, ...payload }));

            const cachedList = getCached('clients') || [];
            setCached('clients', cachedList.map((c) => (c.id === clientId ? { ...c, ...payload } : c)));
        } catch (err) {
            console.error('Erreur annulation RDV:', err);
        } finally {
            setSaving(false);
        }
    }

    // ─── Terminer un RDV -> Archiver dans le journal des échanges ──────────────
    async function handleFinishRdvArchive() {
        setSaving(true);
        try {
            const now = new Date();
            const nouvelEchange = {
                id: 'ech_' + Date.now(),
                date: client.prochainRdvDate || now.toISOString().split('T')[0],
                titre: client.prochainRdvObjet || 'Réunion client',
                format: client.prochainRdvFormat || 'visio',
                contenu: finishRdvNotes.trim() || 'Rendez-vous effectué.',
                createdAt: now.toISOString(),
            };

            const updatedHistorique = [nouvelEchange, ...(client.historiqueEchanges || [])];

            const payload = {
                prochainRdvDate: null,
                prochainRdvHeure: null,
                prochainRdvFormat: null,
                prochainRdvObjet: null,
                prochainRdvLien: null,
                historiqueEchanges: updatedHistorique,
                updatedAt: serverTimestamp(),
            };

            await updateDoc(doc(db, 'clients', clientId), payload);
            setClient((prev) => ({ ...prev, ...payload }));
            setShowFinishRdvModal(false);
            setFinishRdvNotes('');

            const cachedList = getCached('clients') || [];
            setCached('clients', cachedList.map((c) => (c.id === clientId ? { ...c, ...payload } : c)));
        } catch (err) {
            console.error('Erreur archivage RDV:', err);
        } finally {
            setSaving(false);
        }
    }

    // ─── Tâches / To-do list ──────────────────────────────────────────────────
    async function handleAddTodo(e) {
        e.preventDefault();
        const texte = newTodoText.trim();
        if (!texte) return;

        const nouvelleTache = {
            id: 'tsk_' + Date.now(),
            texte,
            fait: false,
            createdAt: new Date().toISOString(),
        };

        const updatedTaches = [...(client.taches || []), nouvelleTache];
        setNewTodoText('');

        // Mise à jour optimiste
        setClient((prev) => ({ ...prev, taches: updatedTaches }));
        try {
            await updateDoc(doc(db, 'clients', clientId), {
                taches: updatedTaches,
                updatedAt: serverTimestamp(),
            });
        } catch (err) {
            console.error('Erreur ajout tâche:', err);
        }
    }

    async function handleToggleTodo(tacheId) {
        const updatedTaches = (client.taches || []).map((t) =>
            t.id === tacheId ? { ...t, fait: !t.fait } : t
        );
        setClient((prev) => ({ ...prev, taches: updatedTaches }));
        try {
            await updateDoc(doc(db, 'clients', clientId), {
                taches: updatedTaches,
                updatedAt: serverTimestamp(),
            });
        } catch (err) {
            console.error('Erreur toggle tâche:', err);
        }
    }

    async function handleDeleteTodo(tacheId) {
        const updatedTaches = (client.taches || []).filter((t) => t.id !== tacheId);
        setClient((prev) => ({ ...prev, taches: updatedTaches }));
        try {
            await updateDoc(doc(db, 'clients', clientId), {
                taches: updatedTaches,
                updatedAt: serverTimestamp(),
            });
        } catch (err) {
            console.error('Erreur suppression tâche:', err);
        }
    }

    // ─── Journal des échanges ──────────────────────────────────────────────────
    async function handleAddExchange(e) {
        e.preventDefault();
        if (!exchangeForm.titre.trim()) return;

        const nouvelEchange = {
            id: 'ech_' + Date.now(),
            date: exchangeForm.date || new Date().toISOString().split('T')[0],
            titre: exchangeForm.titre.trim(),
            format: exchangeForm.format || 'visio',
            contenu: exchangeForm.contenu.trim(),
            createdAt: new Date().toISOString(),
        };

        const updatedHistorique = [nouvelEchange, ...(client.historiqueEchanges || [])];
        setClient((prev) => ({ ...prev, historiqueEchanges: updatedHistorique }));
        setShowAddExchange(false);
        setExchangeForm({
            date: new Date().toISOString().split('T')[0],
            titre: '',
            format: 'visio',
            contenu: '',
        });

        try {
            await updateDoc(doc(db, 'clients', clientId), {
                historiqueEchanges: updatedHistorique,
                updatedAt: serverTimestamp(),
            });
        } catch (err) {
            console.error('Erreur ajout compte-rendu:', err);
        }
    }

    async function handleDeleteExchange(echId) {
        if (!confirm('Supprimer cette entrée du journal ?')) return;
        const updatedHistorique = (client.historiqueEchanges || []).filter((e) => e.id !== echId);
        setClient((prev) => ({ ...prev, historiqueEchanges: updatedHistorique }));
        try {
            await updateDoc(doc(db, 'clients', clientId), {
                historiqueEchanges: updatedHistorique,
                updatedAt: serverTimestamp(),
            });
        } catch (err) {
            console.error('Erreur suppression échange:', err);
        }
    }

    // ─── Encaisser une facture directement ─────────────────────────────────────
    async function handleMarquerFacturePayee(f) {
        const today = new Date().toISOString().split('T')[0];
        const mvt = [
            { compte: '512', libelle: 'Banque', debit: f.totalTTC, credit: 0 },
            { compte: '411', libelle: f.clientNom || client.nom, debit: 0, credit: f.totalTTC },
        ];
        try {
            const { ecritureId } = await ecrireEcriture({
                journal: 'BQ',
                date: today,
                libelle: `Encaissement facture ${f.numero} - ${f.clientNom || client.nom}`,
                pieceRef: f.numero,
                sourceType: 'facture',
                sourceId: f.id,
                mouvements: mvt,
            });

            await updateDoc(doc(db, 'factures', f.id), {
                statut: 'encaissee',
                dateEncaissement: new Date(today),
                ecritureEncaissIds: [...(f.ecritureEncaissIds ?? []), ecritureId],
                updatedAt: serverTimestamp(),
            });

            setFactures((prev) => prev.map((item) => (item.id === f.id ? { ...item, statut: 'encaissee' } : item)));
        } catch (err) {
            console.error('Erreur encaissement facture:', err);
            alert('Erreur lors de l\'encaissement.');
        }
    }

    if (loading) return <Spinner />;
    if (!client) return null;

    const cat = categories.find((c) => c.id === client.categorieId);
    const siteStatutObj = SITE_STATUTS.find((s) => s.id === client.siteStatut) || SITE_STATUTS[0];
    const clientStatutObj = CLIENT_STATUTS.find((s) => s.id === (client.statutGlobal || client.statutClient)) || CLIENT_STATUTS[0];
    const siteTypeObj = SITE_TYPES.find((t) => t.id === client.siteType) || SITE_TYPES[0];

    // Calcul date de renouvellement & alerte
    let renouvellementAlerte = false;
    let joursRestantsRenouvellement = null;
    if (client.siteDateRenouvellement) {
        const dateRenouv = new Date(client.siteDateRenouvellement);
        const aujourdhui = new Date();
        const diffMs = dateRenouv - aujourdhui;
        joursRestantsRenouvellement = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        if (joursRestantsRenouvellement <= 30 && joursRestantsRenouvellement >= 0) {
            renouvellementAlerte = true;
        }
    }

    return (
        <div>
            {/* ─── Fil d'Ariane & En-tête sobre ─── */}
            <div className="client-breadcrumb">
                <Link to="/clients">Clients</Link>
                <span style={{ margin: '0 6px', opacity: 0.5 }}>/</span>
                <span>{client.nom}</span>
            </div>

            <div className="client-detail-header">
                <div>
                    <div className="client-title-row">
                        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>{client.nom}</h1>
                        <span className={`status-tag ${siteStatutObj.cls}`}>
                            {siteStatutObj.label}
                        </span>
                        {cat && (
                            <span
                                className="badge"
                                style={{
                                    background: cat.couleur + '18',
                                    color: cat.couleur,
                                    border: `1px solid ${cat.couleur}44`,
                                }}
                            >
                                {cat.nom}
                            </span>
                        )}
                        <span className={`badge ${clientStatutObj.cls}`}>
                            {clientStatutObj.label}
                        </span>
                    </div>
                    <div style={{ marginTop: 4, color: 'var(--text-muted)', fontSize: 13 }}>
                        {[
                            client.contactPrenom || client.contactNom ? `${client.contactPrenom || ''} ${client.contactNom || ''}`.trim() : null,
                            client.contactRole || null,
                            client.email || null,
                            client.telephone || null,
                            client.quiGere ? `Géré par : ${client.quiGere}` : null,
                        ].filter(Boolean).join('  ·  ')}
                    </div>
                    {(client.prochaineAction || client.dernierContactDate) && (
                        <div style={{ marginTop: 6, fontSize: 12, display: 'flex', gap: 14, color: 'var(--text-muted)' }}>
                            {client.dernierContactDate && (
                                <span>Dernier contact : <strong>{formatDate(client.dernierContactDate)}</strong></span>
                            )}
                            {client.prochaineAction && (
                                <span>Prochaine action : <strong style={{ color: 'var(--accent)' }}>{client.prochaineAction}</strong></span>
                            )}
                        </div>
                    )}
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => setShowAttachDepenseModal(true)}
                    >
                        + Rattacher une dépense
                    </button>
                    <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => setShowAttachRecetteModal(true)}
                    >
                        + Rattacher une recette
                    </button>
                    <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => openRdvModal(false)}
                    >
                        + Planifier un RDV
                    </button>
                    <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => navigate(`/facturation/nouvelle?clientId=${client.id}`)}
                    >
                        + Nouvelle facture
                    </button>
                    {!edit ? (
                        <button
                            type="button"
                            className="btn btn--primary btn--sm"
                            onClick={() => { setEdit(true); setEditForm(client); }}
                        >
                            Modifier la fiche
                        </button>
                    ) : (
                        <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => { setEdit(false); setEditForm(client); }}
                        >
                            Fermer l'édition
                        </button>
                    )}
                </div>
            </div>

            {/* ─── Bandeau Métriques Financières & Techniques ─── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 20 }}>
                <div className="card" style={{ padding: '14px 18px', marginBottom: 0 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
                        CA Facturé
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>
                        {formatMontant(caGlobal)}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                        {factures.length} facture{factures.length > 1 ? 's' : ''} émise{factures.length > 1 ? 's' : ''}
                    </div>
                </div>

                <div className="card" style={{ padding: '14px 18px', marginBottom: 0 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
                        En attente d'encaissement
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: totalEnAttenteTTC > 0 ? 'var(--warning)' : 'var(--success)' }}>
                        {formatMontant(totalEnAttenteTTC)}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                        {countEnAttente > 0 ? `${countEnAttente} facture(s) en attente` : 'Tout est réglé'}
                    </div>
                </div>

                <div className="card" style={{ padding: '14px 18px', marginBottom: 0 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
                        Forfait mensuel (MRR)
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: mrr > 0 ? 'var(--accent)' : 'var(--text-muted)' }}>
                        {mrr > 0 ? `${formatMontant(mrr)} / mois` : 'Aucun'}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                        Maintenance & hébergement
                    </div>
                </div>

                <div className="card" style={{ padding: '14px 18px', marginBottom: 0 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
                        Rentabilité nette
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: (margeNette ?? 0) >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                        {margeNette !== null ? formatMontant(margeNette) : '—'}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                        {pourcentageMarge !== null ? `Marge brute : ${pourcentageMarge.toFixed(1)} %` : 'Aucune dépense liée'}
                    </div>
                </div>
            </div>

            {/* ─── Mode Édition de la Fiche Client ─── */}
            {edit && (
                <div className="card" style={{ marginBottom: 24, border: '1px solid var(--accent)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                        <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>
                            Modifier la fiche client et les informations du site
                        </div>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Tous les champs sont modifiables</span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
                        {/* Coordonnées & Administratif */}
                        <div>
                            <div style={{ fontWeight: 600, fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', marginBottom: 12 }}>
                                1. Entreprise & Contact
                            </div>
                            <div className="form-group">
                                <label className="form-label">Raison sociale / Entreprise *</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    value={editForm.nom ?? ''}
                                    onChange={(e) => setEditForm((f) => ({ ...f, nom: e.target.value }))}
                                    placeholder="Ex. Château de Montmirail"
                                />
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Prénom contact</label>
                                    <input
                                        type="text"
                                        className="form-input"
                                        value={editForm.contactPrenom ?? ''}
                                        onChange={(e) => setEditForm((f) => ({ ...f, contactPrenom: e.target.value }))}
                                        placeholder="Ex. Alexandre"
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Nom contact</label>
                                    <input
                                        type="text"
                                        className="form-input"
                                        value={editForm.contactNom ?? ''}
                                        onChange={(e) => setEditForm((f) => ({ ...f, contactNom: e.target.value }))}
                                        placeholder="Ex. Martin"
                                    />
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Rôle / Fonction</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    value={editForm.contactRole ?? ''}
                                    onChange={(e) => setEditForm((f) => ({ ...f, contactRole: e.target.value }))}
                                    placeholder="Ex. Gérant, Dir. Marketing"
                                />
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Email</label>
                                    <input
                                        type="email"
                                        className="form-input"
                                        value={editForm.email ?? ''}
                                        onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                                        placeholder="contact@client.fr"
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Téléphone</label>
                                    <input
                                        type="tel"
                                        className="form-input"
                                        value={editForm.telephone ?? ''}
                                        onChange={(e) => setEditForm((f) => ({ ...f, telephone: e.target.value }))}
                                        placeholder="06 12 34 56 78"
                                    />
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Adresse postale</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    value={editForm.adresse ?? ''}
                                    onChange={(e) => setEditForm((f) => ({ ...f, adresse: e.target.value }))}
                                    placeholder="12 rue de la République"
                                />
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Code postal</label>
                                    <input
                                        type="text"
                                        className="form-input"
                                        value={editForm.codePostal ?? ''}
                                        onChange={(e) => setEditForm((f) => ({ ...f, codePostal: e.target.value }))}
                                        placeholder="75001"
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Ville</label>
                                    <input
                                        type="text"
                                        className="form-input"
                                        value={editForm.ville ?? ''}
                                        onChange={(e) => setEditForm((f) => ({ ...f, ville: e.target.value }))}
                                        placeholder="Paris"
                                    />
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Numéro SIRET</label>
                                    <input
                                        type="text"
                                        className="form-input"
                                        value={editForm.siret ?? ''}
                                        onChange={(e) => setEditForm((f) => ({ ...f, siret: e.target.value }))}
                                        placeholder="123 456 789 00012"
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">N° TVA Intracommunautaire</label>
                                    <input
                                        type="text"
                                        className="form-input"
                                        value={editForm.tvaIntra ?? ''}
                                        onChange={(e) => setEditForm((f) => ({ ...f, tvaIntra: e.target.value }))}
                                        placeholder="FR 12 345678901"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Site Internet & Technique */}
                        <div>
                            <div style={{ fontWeight: 600, fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', marginBottom: 12 }}>
                                2. Site Internet & Infrastructure
                            </div>
                            <div className="form-group">
                                <label className="form-label">URL du site internet</label>
                                <input
                                    type="url"
                                    className="form-input"
                                    value={editForm.siteUrl ?? ''}
                                    onChange={(e) => setEditForm((f) => ({ ...f, siteUrl: e.target.value }))}
                                    placeholder="https://mon-client.fr"
                                />
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Statut du site</label>
                                    <select
                                        className="form-select"
                                        value={editForm.siteStatut ?? 'en_ligne'}
                                        onChange={(e) => setEditForm((f) => ({ ...f, siteStatut: e.target.value }))}
                                    >
                                        {SITE_STATUTS.map((s) => (
                                            <option key={s.id} value={s.id}>{s.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Type de site</label>
                                    <select
                                        className="form-select"
                                        value={editForm.siteType ?? 'vitrine'}
                                        onChange={(e) => setEditForm((f) => ({ ...f, siteType: e.target.value }))}
                                    >
                                        {SITE_TYPES.map((t) => (
                                            <option key={t.id} value={t.id}>{t.label}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">CMS / Stack technique</label>
                                    <input
                                        type="text"
                                        className="form-input"
                                        value={editForm.siteStack ?? ''}
                                        onChange={(e) => setEditForm((f) => ({ ...f, siteStack: e.target.value }))}
                                        placeholder="Ex. WordPress, Next.js, Shopify"
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Hébergeur & Registrar</label>
                                    <input
                                        type="text"
                                        className="form-input"
                                        value={editForm.siteHebergeur ?? ''}
                                        onChange={(e) => setEditForm((f) => ({ ...f, siteHebergeur: e.target.value }))}
                                        placeholder="Ex. OVH, Infomaniak, Vercel"
                                    />
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Date mise en ligne</label>
                                    <DateInput
                                        className="form-input"
                                        value={editForm.siteDateLigne ?? ''}
                                        onChange={(e) => setEditForm((f) => ({ ...f, siteDateLigne: e.target.value }))}
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Échéance renouvellement</label>
                                    <DateInput
                                        className="form-input"
                                        value={editForm.siteDateRenouvellement ?? ''}
                                        onChange={(e) => setEditForm((f) => ({ ...f, siteDateRenouvellement: e.target.value }))}
                                    />
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Notes techniques / Accès / DNS</label>
                                <textarea
                                    className="form-textarea"
                                    value={editForm.notesTechniques ?? ''}
                                    onChange={(e) => setEditForm((f) => ({ ...f, notesTechniques: e.target.value }))}
                                    placeholder="Zone DNS, identifiants techniques, configurations serveur..."
                                    rows={3}
                                />
                            </div>

                            <div style={{ fontWeight: 600, fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', marginTop: 16, marginBottom: 12 }}>
                                3. Catégorie & Financier
                            </div>
                            <div className="form-row form-row--3">
                                <div className="form-group">
                                    <label className="form-label">Catégorie client</label>
                                    <select
                                        className="form-select"
                                        value={editForm.categorieId ?? ''}
                                        onChange={(e) => setEditForm((f) => ({ ...f, categorieId: e.target.value }))}
                                    >
                                        <option value="">Non catégorisé</option>
                                        {categories.map((c) => (
                                            <option key={c.id} value={c.id}>{c.nom}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Statut relation</label>
                                    <select
                                        className="form-select"
                                        value={editForm.statutClient ?? 'client_actif'}
                                        onChange={(e) => setEditForm((f) => ({ ...f, statutClient: e.target.value }))}
                                    >
                                        {CLIENT_STATUTS.map((s) => (
                                            <option key={s.id} value={s.id}>{s.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Forfait MRR (EUR/mois)</label>
                                    <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        className="form-input"
                                        value={editForm.abonnementMensuelManuel ?? ''}
                                        onChange={(e) => setEditForm((f) => ({ ...f, abonnementMensuelManuel: e.target.value }))}
                                        placeholder="0.00"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: 10, marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                        <button
                            type="button"
                            className="btn btn--primary"
                            disabled={saving || !editForm.nom?.trim()}
                            onClick={handleSaveEdit}
                        >
                            {saving ? 'Enregistrement...' : 'Enregistrer les modifications'}
                        </button>
                        <button
                            type="button"
                            className="btn btn--ghost"
                            onClick={() => { setEdit(false); setEditForm(client); }}
                        >
                            Annuler
                        </button>
                    </div>
                </div>
            )}

            {/* ─── Contenu Principal en 2 Colonnes ─── */}
            <div className="client-grid">
                {/* ────────────────────────────────────────────────────────── */}
                {/* COLONNE GAUCHE : Suivi Opérationnel & Relationnel          */}
                {/* ────────────────────────────────────────────────────────── */}
                <div className="client-section">
                    {/* Bloc 1 : Prochain Rendez-vous */}
                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div className="card__title" style={{ margin: 0 }}>
                                Prochain rendez-vous
                            </div>
                            {client.prochainRdvDate && (
                                <div style={{ display: 'flex', gap: 6 }}>
                                    <button
                                        type="button"
                                        className="btn btn--sm btn--primary"
                                        onClick={() => setShowFinishRdvModal(true)}
                                    >
                                        Marquer comme effectué
                                    </button>
                                    <button
                                        type="button"
                                        className="btn btn--sm btn--ghost"
                                        onClick={() => openRdvModal(true)}
                                    >
                                        Modifier
                                    </button>
                                    <button
                                        type="button"
                                        className="btn btn--sm btn--ghost"
                                        onClick={handleCancelRdv}
                                        title="Annuler le rendez-vous"
                                    >
                                        Annuler
                                    </button>
                                </div>
                            )}
                        </div>

                        <div style={{ padding: '16px 20px' }}>
                            {client.prochainRdvDate ? (
                                <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                                        <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
                                            {formatDate(client.prochainRdvDate)} à {client.prochainRdvHeure || '14:00'}
                                        </span>
                                        <span className="badge badge--info">
                                            {RDV_FORMATS.find((f) => f.id === client.prochainRdvFormat)?.label || 'Visioconférence'}
                                        </span>
                                    </div>
                                    <div style={{ fontSize: 14, color: 'var(--text)', marginBottom: 8, fontWeight: 500 }}>
                                        {client.prochainRdvObjet || 'Point d\'étape'}
                                    </div>
                                    {client.prochainRdvLien && (
                                        <div style={{ marginTop: 6, fontSize: 13 }}>
                                            {client.prochainRdvLien.startsWith('http') ? (
                                                <a
                                                    href={client.prochainRdvLien}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600 }}
                                                >
                                                    Accéder à la réunion [↗]
                                                </a>
                                            ) : (
                                                <span style={{ color: 'var(--text-muted)' }}>Lieu : {client.prochainRdvLien}</span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                                        Aucun rendez-vous planifié avec ce client.
                                    </span>
                                    <button
                                        type="button"
                                        className="btn btn--ghost btn--sm"
                                        onClick={() => openRdvModal(false)}
                                    >
                                        + Planifier un RDV
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Bloc 2 : Tâches & Prochaines étapes (To-Do) */}
                    <div className="card" style={{ padding: '16px 20px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                            <div className="card__title" style={{ margin: 0 }}>
                                Tâches en cours & actions
                            </div>
                            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                {(client.taches || []).filter((t) => !t.fait).length} active(s)
                            </span>
                        </div>

                        {/* Liste des tâches */}
                        <div style={{ marginBottom: 12 }}>
                            {(client.taches || []).length === 0 ? (
                                <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '6px 0' }}>
                                    Aucune tâche en cours pour ce site.
                                </div>
                            ) : (
                                (client.taches || []).map((t) => (
                                    <div key={t.id} className="todo-item">
                                        <input
                                            type="checkbox"
                                            className="todo-checkbox"
                                            checked={t.fait}
                                            onChange={() => handleToggleTodo(t.id)}
                                        />
                                        <span className={`todo-text ${t.fait ? 'todo-text--done' : ''}`}>
                                            {t.texte}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => handleDeleteTodo(t.id)}
                                            style={{
                                                background: 'transparent',
                                                border: 'none',
                                                cursor: 'pointer',
                                                color: 'var(--text-light)',
                                                padding: '2px 6px',
                                                fontSize: 14,
                                                lineHeight: 1,
                                            }}
                                            title="Supprimer la tâche"
                                        >
                                            ×
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>

                        {/* Ajout rapide d'une tâche */}
                        <form onSubmit={handleAddTodo} style={{ display: 'flex', gap: 8 }}>
                            <input
                                type="text"
                                className="form-input"
                                placeholder="Ajouter une tâche (ex: Valider maquette accueil, DNS...)"
                                value={newTodoText}
                                onChange={(e) => setNewTodoText(e.target.value)}
                                style={{ fontSize: 13 }}
                            />
                            <button
                                type="submit"
                                className="btn btn--primary btn--sm"
                                disabled={!newTodoText.trim()}
                            >
                                Ajouter
                            </button>
                        </form>
                    </div>

                    {/* Bloc 3 : Journal des échanges & comptes-rendus */}
                    <div className="card" style={{ padding: '16px 20px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                            <div className="card__title" style={{ margin: 0 }}>
                                Journal des échanges
                            </div>
                            <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                onClick={() => setShowAddExchange((prev) => !prev)}
                            >
                                {showAddExchange ? 'Fermer' : '+ Ajouter une note'}
                            </button>
                        </div>

                        {/* Formulaire ajout compte-rendu */}
                        {showAddExchange && (
                            <form onSubmit={handleAddExchange} style={{ background: 'var(--bg2)', padding: 14, borderRadius: 'var(--radius)', border: '1px solid var(--border)', marginBottom: 14 }}>
                                <div className="form-row" style={{ marginBottom: 10 }}>
                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                        <label className="form-label" style={{ fontSize: 12 }}>Date</label>
                                        <DateInput
                                            className="form-input"
                                            value={exchangeForm.date}
                                            onChange={(e) => setExchangeForm((f) => ({ ...f, date: e.target.value }))}
                                        />
                                    </div>
                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                        <label className="form-label" style={{ fontSize: 12 }}>Format</label>
                                        <select
                                            className="form-select"
                                            value={exchangeForm.format}
                                            onChange={(e) => setExchangeForm((f) => ({ ...f, format: e.target.value }))}
                                        >
                                            {RDV_FORMATS.map((f) => (
                                                <option key={f.id} value={f.id}>{f.label}</option>
                                            ))}
                                            <option value="email">Email</option>
                                        </select>
                                    </div>
                                </div>
                                <div className="form-group" style={{ marginBottom: 10 }}>
                                    <label className="form-label" style={{ fontSize: 12 }}>Titre / Objet</label>
                                    <input
                                        type="text"
                                        className="form-input"
                                        placeholder="Ex. Réunion de cadrage, Validation textes..."
                                        value={exchangeForm.titre}
                                        onChange={(e) => setExchangeForm((f) => ({ ...f, titre: e.target.value }))}
                                    />
                                </div>
                                <div className="form-group" style={{ marginBottom: 10 }}>
                                    <label className="form-label" style={{ fontSize: 12 }}>Compte-rendu & décisions</label>
                                    <textarea
                                        className="form-textarea"
                                        rows={3}
                                        placeholder="Notes, remarques, accords du client..."
                                        value={exchangeForm.contenu}
                                        onChange={(e) => setExchangeForm((f) => ({ ...f, contenu: e.target.value }))}
                                    />
                                </div>
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <button type="submit" className="btn btn--primary btn--sm" disabled={!exchangeForm.titre.trim()}>
                                        Enregistrer
                                    </button>
                                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowAddExchange(false)}>
                                        Annuler
                                    </button>
                                </div>
                            </form>
                        )}

                        {/* Liste des entrées */}
                        <div>
                            {(client.historiqueEchanges || []).length === 0 ? (
                                <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '6px 0' }}>
                                    Aucun échange consigné pour l'instant.
                                </div>
                            ) : (
                                (client.historiqueEchanges || []).map((e) => (
                                    <div key={e.id} className="exchange-item">
                                        <div className="exchange-header">
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <span style={{ fontWeight: 600, color: 'var(--text)' }}>
                                                    {formatDate(e.date)}
                                                </span>
                                                <span className="badge badge--muted">
                                                    {RDV_FORMATS.find((f) => f.id === e.format)?.label || (e.format === 'email' ? 'Email' : e.format)}
                                                </span>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => handleDeleteExchange(e.id)}
                                                style={{
                                                    background: 'transparent',
                                                    border: 'none',
                                                    cursor: 'pointer',
                                                    color: 'var(--text-light)',
                                                    fontSize: 11,
                                                }}
                                            >
                                                Supprimer
                                            </button>
                                        </div>
                                        <div className="exchange-title">{e.titre}</div>
                                        {e.contenu && <div className="exchange-content">{e.contenu}</div>}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>

                {/* ────────────────────────────────────────────────────────── */}
                {/* COLONNE DROITE : Données Site Web & Coordonnées            */}
                {/* ────────────────────────────────────────────────────────── */}
                <div className="client-section">
                    {/* Bloc 4 : Site Internet & Infrastructure */}
                    <div className="card" style={{ padding: '16px 20px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                            <div className="card__title" style={{ margin: 0 }}>
                                Site Internet & Technique
                            </div>
                            <span className={`status-tag ${siteStatutObj.cls}`}>
                                {siteStatutObj.label}
                            </span>
                        </div>

                        <div>
                            <div className="tech-spec-row">
                                <span className="tech-spec-label">Adresse du site</span>
                                <span className="tech-spec-val">
                                    {client.siteUrl ? (
                                        <a
                                            href={client.siteUrl.startsWith('http') ? client.siteUrl : `https://${client.siteUrl}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            style={{ fontWeight: 600, color: 'var(--accent)' }}
                                        >
                                            {client.siteUrl.replace(/^https?:\/\//, '')} [↗]
                                        </a>
                                    ) : (
                                        <span style={{ color: 'var(--text-muted)' }}>Non renseigné</span>
                                    )}
                                </span>
                            </div>

                            <div className="tech-spec-row">
                                <span className="tech-spec-label">Type de site</span>
                                <span className="tech-spec-val">{siteTypeObj.label}</span>
                            </div>

                            <div className="tech-spec-row">
                                <span className="tech-spec-label">Stack technique</span>
                                <span className="tech-spec-val">{client.siteStack || '—'}</span>
                            </div>

                            <div className="tech-spec-row">
                                <span className="tech-spec-label">Hébergeur & Domaine</span>
                                <span className="tech-spec-val">{client.siteHebergeur || '—'}</span>
                            </div>

                            <div className="tech-spec-row">
                                <span className="tech-spec-label">Mise en ligne</span>
                                <span className="tech-spec-val">{client.siteDateLigne ? formatDate(client.siteDateLigne) : '—'}</span>
                            </div>

                            <div className="tech-spec-row">
                                <span className="tech-spec-label">Renouvellement</span>
                                <span className="tech-spec-val">
                                    {client.siteDateRenouvellement ? (
                                        <span>
                                            {formatDate(client.siteDateRenouvellement)}
                                            {joursRestantsRenouvellement !== null && (
                                                <span
                                                    className={`badge ${renouvellementAlerte ? 'badge--warning' : 'badge--muted'}`}
                                                    style={{ marginLeft: 6 }}
                                                >
                                                    {joursRestantsRenouvellement > 0 ? `dans ${joursRestantsRenouvellement}j` : 'Échu'}
                                                </span>
                                            )}
                                        </span>
                                    ) : (
                                        '—'
                                    )}
                                </span>
                            </div>
                        </div>

                        {/* Notes d'infrastructure / DNS */}
                        {client.notesTechniques && (
                            <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                                <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
                                    Notes techniques & DNS
                                </div>
                                <div style={{ fontSize: 12, background: 'var(--bg2)', padding: '8px 12px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                                    {client.notesTechniques}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Bloc 5 : Coordonnées & Administratif */}
                    <div className="card" style={{ padding: '16px 20px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                            <div className="card__title" style={{ margin: 0 }}>
                                Coordonnées & Administratif
                            </div>
                            <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                onClick={() => { setEdit(true); setEditForm(client); }}
                            >
                                Éditer
                            </button>
                        </div>

                        <div>
                            <div className="tech-spec-row">
                                <span className="tech-spec-label">Contact</span>
                                <span className="tech-spec-val">
                                    {client.contactPrenom || client.contactNom ? (
                                        <span>
                                            {client.contactPrenom} {client.contactNom}
                                            {client.contactRole && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> ({client.contactRole})</span>}
                                        </span>
                                    ) : (
                                        '—'
                                    )}
                                </span>
                            </div>

                            <div className="tech-spec-row">
                                <span className="tech-spec-label">Email</span>
                                <span className="tech-spec-val">
                                    {client.email ? (
                                        <a href={`mailto:${client.email}`} style={{ color: 'var(--accent)' }}>
                                            {client.email}
                                        </a>
                                    ) : (
                                        '—'
                                    )}
                                </span>
                            </div>

                            <div className="tech-spec-row">
                                <span className="tech-spec-label">Téléphone</span>
                                <span className="tech-spec-val">
                                    {client.telephone ? (
                                        <a href={`tel:${client.telephone}`} style={{ color: 'var(--text)' }}>
                                            {client.telephone}
                                        </a>
                                    ) : (
                                        '—'
                                    )}
                                </span>
                            </div>

                            <div className="tech-spec-row">
                                <span className="tech-spec-label">Adresse</span>
                                <span className="tech-spec-val">
                                    {[client.adresse, client.codePostal, client.ville].filter(Boolean).join(', ') || '—'}
                                </span>
                            </div>

                            <div className="tech-spec-row">
                                <span className="tech-spec-label">SIRET</span>
                                <span className="tech-spec-val">{client.siret || '—'}</span>
                            </div>

                            <div className="tech-spec-row">
                                <span className="tech-spec-label">N° TVA Intra</span>
                                <span className="tech-spec-val">{client.tvaIntra || '—'}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* ─── Section Inférieure : Facturation & Recettes rattachées ─── */}
            <div className="card" style={{ marginTop: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
                    <div>
                        <div className="card__title" style={{ margin: 0 }}>
                            Factures & Recettes de ce client
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                            Factures officielles, facturations clients et règlements ({factures.length + facturations.length} enregistrements)
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => setShowAttachRecetteModal(true)}
                        >
                            + Rattacher une recette existante
                        </button>
                        <button
                            type="button"
                            className="btn btn--primary btn--sm"
                            onClick={() => navigate(`/facturation/nouvelle?clientId=${client.id}`)}
                        >
                            + Émettre une facture
                        </button>
                    </div>
                </div>

                <div className="table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>Référence / Type</th>
                                <th>Date</th>
                                <th>Prestations / Description</th>
                                <th style={{ textAlign: 'right' }}>Total HT</th>
                                <th style={{ textAlign: 'right' }}>Total TTC</th>
                                <th>Statut</th>
                                <th style={{ textAlign: 'right' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {factures.length === 0 && facturations.length === 0 ? (
                                <tr>
                                    <td colSpan={7} style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 24 }}>
                                        Aucune facture ni recette rattachée à ce client pour le moment.
                                    </td>
                                </tr>
                            ) : (
                                <>
                                    {/* Factures légales */}
                                    {factures.map((f) => (
                                        <tr key={f.id}>
                                            <td style={{ fontWeight: 600 }}>
                                                <span className="badge badge--primary" style={{ marginRight: 6 }}>Facture</span>
                                                {f.numero}
                                            </td>
                                            <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{formatDate(f.dateFacture)}</td>
                                            <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>Facture n° {f.numero}</td>
                                            <td style={{ textAlign: 'right', fontSize: 13 }}>{formatMontant(f.totalHT ?? f.totalTTC)}</td>
                                            <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatMontant(f.totalTTC)}</td>
                                            <td>
                                                {f.statut === 'encaissee' ? (
                                                    <span className="badge badge--success">Encaissée</span>
                                                ) : f.statut === 'annulee' ? (
                                                    <span className="badge badge--danger">Annulée</span>
                                                ) : (
                                                    <span className="badge badge--warning">En attente</span>
                                                )}
                                            </td>
                                            <td style={{ textAlign: 'right' }}>
                                                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                                                    {f.statut === 'en_attente' && (
                                                        <button
                                                            type="button"
                                                            className="btn btn--sm btn--ghost"
                                                            onClick={() => handleMarquerFacturePayee(f)}
                                                        >
                                                            Encaisser
                                                        </button>
                                                    )}
                                                    <button
                                                        type="button"
                                                        className="btn btn--sm btn--ghost"
                                                        title="Détacher de ce client"
                                                        onClick={() => handleDetacherRecette(f, 'facture')}
                                                        style={{ color: 'var(--text-muted)' }}
                                                    >
                                                        Détacher
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}

                                    {/* Facturations clients */}
                                    {facturations.map((factu) => (
                                        <tr key={factu.id}>
                                            <td style={{ fontWeight: 600 }}>
                                                <span className="badge badge--info" style={{ marginRight: 6 }}>Facturation</span>
                                                {factu.clientNom || 'Client'}
                                            </td>
                                            <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{formatDate(factu.date || factu.dateFacturation)}</td>
                                            <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                                {factu.lignes?.map((l) => l.description).join(', ') || 'Prestations'}
                                            </td>
                                            <td style={{ textAlign: 'right', fontSize: 13 }}>{formatMontant(factu.totalFacture)}</td>
                                            <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--success)' }}>{formatMontant(factu.totalFacture)}</td>
                                            <td>
                                                {factu.statut === 'encaissee' || factu.withStripe ? (
                                                    <span className="badge badge--success">Encaissé</span>
                                                ) : (
                                                    <span className="badge badge--warning">En attente</span>
                                                )}
                                            </td>
                                            <td style={{ textAlign: 'right' }}>
                                                <button
                                                    type="button"
                                                    className="btn btn--sm btn--ghost"
                                                    title="Détacher de ce client"
                                                    onClick={() => handleDetacherRecette(factu, 'facturation')}
                                                    style={{ color: 'var(--text-muted)' }}
                                                >
                                                    Détacher
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </>
                            )}
                        </tbody>
                        {(factures.length > 0 || facturations.length > 0) && (
                            <tfoot>
                                <tr>
                                    <td colSpan={3}><strong>Total facturé</strong></td>
                                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatMontant(totalFactureHT)}</td>
                                    <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--success)' }}>{formatMontant(totalFactureTTC)}</td>
                                    <td colSpan={2}></td>
                                </tr>
                            </tfoot>
                        )}
                    </table>
                </div>
            </div>

            {/* ─── Dépenses rattachées au projet / client ─── */}
            <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
                    <div>
                        <div className="card__title" style={{ margin: 0 }}>
                            Dépenses analytiques rattachées à ce projet
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                            Coûts directs engagés pour {client.nom} ({depenses.length} dépense{depenses.length > 1 ? 's' : ''})
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => setShowAttachDepenseModal(true)}
                        >
                            + Rattacher une dépense existante
                        </button>
                        <button
                            type="button"
                            className="btn btn--primary btn--sm"
                            onClick={() => navigate(`/depenses/nouvelle?clientId=${client.id}`)}
                        >
                            + Nouvelle dépense
                        </button>
                    </div>
                </div>

                {depenses.length === 0 ? (
                    <div style={{ padding: '24px 16px', textAlign: 'center', background: 'var(--bg2)', borderRadius: 'var(--radius)', border: '1px dashed var(--border)' }}>
                        <p style={{ color: 'var(--text-muted)', marginBottom: 10, fontSize: 13 }}>
                            Aucune dépense n'est encore imputée à ce client.
                        </p>
                        <button
                            type="button"
                            className="btn btn--sm btn--ghost"
                            onClick={() => setShowAttachDepenseModal(true)}
                        >
                            + Parcourir et rattacher une dépense existante
                        </button>
                    </div>
                ) : (
                    <div className="table-wrap">
                        <table>
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Fournisseur</th>
                                    <th>Description</th>
                                    <th>Catégorie</th>
                                    <th style={{ textAlign: 'right' }}>Montant TTC</th>
                                    <th>Statut</th>
                                    <th style={{ textAlign: 'right' }}>Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {depenses.map((d) => (
                                    <tr key={d.id}>
                                        <td style={{ fontSize: 12 }}>{formatDate(d.dateDépense)}</td>
                                        <td style={{ fontWeight: 500 }}>{d.fournisseurNom || '—'}</td>
                                        <td style={{ fontSize: 13, color: 'var(--text-muted)' }}>{d.description}</td>
                                        <td>
                                            <span className="badge badge--muted" style={{ fontSize: 11 }}>
                                                {d.categorieLabel || 'Dépense'}
                                            </span>
                                        </td>
                                        <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--danger)' }}>
                                            − {formatMontant(d.montantTTC ?? d.montant)}
                                        </td>
                                        <td>
                                            {d.statut === 'payee' ? (
                                                <span className="badge badge--success">Payée</span>
                                            ) : (
                                                <span className="badge badge--warning">À payer</span>
                                            )}
                                        </td>
                                        <td style={{ textAlign: 'right' }}>
                                            <button
                                                type="button"
                                                className="btn btn--sm btn--ghost"
                                                title="Détacher de ce client"
                                                onClick={() => handleDetacherDepense(d.id)}
                                                style={{ color: 'var(--text-muted)' }}
                                            >
                                                Détacher
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr>
                                    <td colSpan={4}><strong>Total dépenses projet</strong></td>
                                    <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--danger)' }}>
                                        − {formatMontant(totalDepensesTTC)}
                                    </td>
                                    <td></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                )}
            </div>

            {/* ─── Modal Planifier / Modifier Rendez-vous (Connecté à l'Agenda) ─── */}
            {showRdvModal && (
                <ModalCreateRdv
                    preselectedClient={client}
                    preselectedDate={client.prochainRdvDate || new Date().toISOString().split('T')[0]}
                    preselectedTime={client.prochainRdvHeure || '14:00'}
                    clients={[client]}
                    allRdvs={allRdvs}
                    onClose={() => setShowRdvModal(false)}
                    onSaved={(saved) => {
                        setAllRdvs((prev) => [...prev.filter((r) => r.id !== saved.id), saved]);
                        setClient((prev) => ({
                            ...prev,
                            prochainRdvDate: saved.date,
                            prochainRdvHeure: saved.heureDebut,
                            prochainRdvFormat: saved.type,
                            prochainRdvObjet: saved.notes || `Rendez-vous ${saved.type}`,
                            prochainRdvLien: saved.lienVisio || saved.lieu || '',
                        }));
                        setShowRdvModal(false);
                    }}
                />
            )}

            {/* ─── Modal Terminer le Rendez-vous & Archiver ─── */}
            {showFinishRdvModal && (
                <div style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    zIndex: 1000, padding: 20,
                }}>
                    <div className="card" style={{ maxWidth: 480, width: '100%', padding: 24, boxShadow: 'var(--shadow-md)' }}>
                        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>
                            Archiver le rendez-vous effectué
                        </div>
                        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
                            Le rendez-vous du <strong>{formatDate(client.prochainRdvDate)}</strong> ({client.prochainRdvObjet}) sera marqué comme terminé et archivé dans le journal des échanges.
                        </p>

                        <div className="form-group">
                            <label className="form-label">Compte-rendu & décisions (optionnel)</label>
                            <textarea
                                className="form-textarea"
                                rows={4}
                                placeholder="Synthèse de l'échange, prochaines étapes convenues avec le client..."
                                value={finishRdvNotes}
                                onChange={(e) => setFinishRdvNotes(e.target.value)}
                            />
                        </div>

                        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
                            <button
                                type="button"
                                className="btn btn--ghost"
                                onClick={() => setShowFinishRdvModal(false)}
                            >
                                Annuler
                            </button>
                            <button
                                type="button"
                                className="btn btn--primary"
                                disabled={saving}
                                onClick={handleFinishRdvArchive}
                            >
                                {saving ? 'Archivage...' : 'Valider et archiver dans le journal'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Modale : Rattacher une Dépense Existante ───────────────── */}
            {showAttachDepenseModal && (
                <ModalRattacherDepense
                    client={client}
                    depenses={allDepenses}
                    onRattacher={handleRattacherDepense}
                    onDetacher={handleDetacherDepense}
                    onClose={() => setShowAttachDepenseModal(false)}
                />
            )}

            {/* ─── Modale : Rattacher une Recette / Facture Existante ───────── */}
            {showAttachRecetteModal && (
                <ModalRattacherRecette
                    client={client}
                    factures={allFactures}
                    facturations={allFacturations}
                    onRattacher={handleRattacherRecette}
                    onDetacher={handleDetacherRecette}
                    onClose={() => setShowAttachRecetteModal(false)}
                />
            )}
        </div>
    );
}

// ─── Modal : Rattacher une Dépense Existante ─────────────────────────────────
function ModalRattacherDepense({ client, depenses, onRattacher, onDetacher, onClose }) {
    const [search, setSearch] = useState('');
    const [filterTab, setFilterTab] = useState('toutes'); // 'toutes' | 'libres' | 'liees'

    const filtered = useMemo(() => {
        return depenses.filter((d) => {
            const isLieeCeClient = d.clientProjetId === client.id || d.clientId === client.id || (client.nom && d.clientProjetNom === client.nom);
            const isLibre = !d.clientProjetId && !d.clientId;

            if (filterTab === 'libres' && !isLibre) return false;
            if (filterTab === 'liees' && !isLieeCeClient) return false;

            if (!search.trim()) return true;
            const q = search.toLowerCase();
            const text = `${d.fournisseurNom || ''} ${d.description || ''} ${d.categorieLabel || ''} ${d.montant || ''}`.toLowerCase();
            return text.includes(q);
        });
    }, [depenses, client, search, filterTab]);

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <div>
                        <div style={{ fontWeight: 700, fontSize: 16 }}>
                            Rattacher des dépenses à {client.nom}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                            Sélectionnez les dépenses à imputer à ce projet pour mettre à jour la marge nette.
                        </div>
                    </div>
                    <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={onClose}
                        style={{ padding: '4px 8px', fontSize: 14 }}
                    >
                        ✕
                    </button>
                </div>

                <div className="modal-body">
                    {/* Recherche et filtres */}
                    <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                        <input
                            type="text"
                            className="form-input"
                            placeholder="Filtrer par fournisseur, motif, montant..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            style={{ flex: 1, minWidth: 200 }}
                            autoFocus
                        />
                        <div className="view-tabs">
                            <button
                                type="button"
                                className={`view-tab-btn ${filterTab === 'toutes' ? 'view-tab-btn--active' : ''}`}
                                onClick={() => setFilterTab('toutes')}
                                style={{ padding: '4px 10px', fontSize: 12 }}
                            >
                                Toutes ({depenses.length})
                            </button>
                            <button
                                type="button"
                                className={`view-tab-btn ${filterTab === 'libres' ? 'view-tab-btn--active' : ''}`}
                                onClick={() => setFilterTab('libres')}
                                style={{ padding: '4px 10px', fontSize: 12 }}
                            >
                                Non rattachées
                            </button>
                            <button
                                type="button"
                                className={`view-tab-btn ${filterTab === 'liees' ? 'view-tab-btn--active' : ''}`}
                                onClick={() => setFilterTab('liees')}
                                style={{ padding: '4px 10px', fontSize: 12 }}
                            >
                                Rattachées à ce client
                            </button>
                        </div>
                    </div>

                    {/* Liste des dépenses */}
                    {filtered.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)', fontSize: 13 }}>
                            Aucune dépense ne correspond aux critères.
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {filtered.map((d) => {
                                const isLieeCeClient = d.clientProjetId === client.id || d.clientId === client.id || (client.nom && d.clientProjetNom === client.nom);
                                const isLieeAutre = (d.clientProjetId || d.clientId) && !isLieeCeClient;

                                return (
                                    <div
                                        key={d.id}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            padding: '10px 14px',
                                            background: isLieeCeClient ? '#ecfdf5' : 'var(--bg2)',
                                            border: `1px solid ${isLieeCeClient ? '#a7f3d0' : 'var(--border)'}`,
                                            borderRadius: 'var(--radius)',
                                            gap: 12,
                                        }}
                                    >
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                                <span style={{ fontWeight: 600, fontSize: 13 }}>
                                                    {d.fournisseurNom || 'Fournisseur'}
                                                </span>
                                                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                                    {formatDate(d.dateDépense || d.date)}
                                                </span>
                                                <span className="badge badge--muted" style={{ fontSize: 10 }}>
                                                    {d.categorieLabel || 'Dépense'}
                                                </span>
                                                {isLieeCeClient && (
                                                    <span className="badge badge--success" style={{ fontSize: 10 }}>
                                                        Rattachée à ce client
                                                    </span>
                                                )}
                                                {isLieeAutre && (
                                                    <span className="badge badge--warning" style={{ fontSize: 10 }}>
                                                        Rattachée à {d.clientProjetNom || d.clientNom || 'autre'}
                                                    </span>
                                                )}
                                            </div>
                                            {d.description && (
                                                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                    {d.description}
                                                </div>
                                            )}
                                        </div>

                                        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                                            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--danger)', whiteSpace: 'nowrap' }}>
                                                − {formatMontant(d.montantTTC ?? d.montant ?? 0)}
                                            </div>

                                            {isLieeCeClient ? (
                                                <button
                                                    type="button"
                                                    className="btn btn--ghost btn--sm"
                                                    onClick={() => onDetacher(d.id)}
                                                    style={{ color: 'var(--danger)', fontSize: 12 }}
                                                >
                                                    Détacher
                                                </button>
                                            ) : (
                                                <button
                                                    type="button"
                                                    className="btn btn--primary btn--sm"
                                                    onClick={() => onRattacher(d.id)}
                                                    style={{ fontSize: 12 }}
                                                >
                                                    {isLieeAutre ? 'Transférer ici' : '+ Rattacher'}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className="modal-footer">
                    <button type="button" className="btn btn--primary btn--sm" onClick={onClose}>
                        Fermer
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Modal : Rattacher une Recette / Facture ─────────────────────────────────
function ModalRattacherRecette({ client, factures, facturations, onRattacher, onDetacher, onClose }) {
    const [search, setSearch] = useState('');
    const [filterTab, setFilterTab] = useState('toutes'); // 'toutes' | 'libres' | 'liees'

    const allRecettes = useMemo(() => {
        const list = [];
        factures.forEach((f) => list.push({ ...f, typeRecette: 'facture', refTitre: `Facture #${f.numero || ''}` }));
        facturations.forEach((f) => list.push({ ...f, typeRecette: 'facturation', refTitre: f.clientNom ? `Facturation ${f.clientNom}` : 'Facturation client' }));
        return list;
    }, [factures, facturations]);

    const filtered = useMemo(() => {
        return allRecettes.filter((r) => {
            const isLieeCeClient = r.clientId === client.id;
            const isLibre = !r.clientId;

            if (filterTab === 'libres' && !isLibre) return false;
            if (filterTab === 'liees' && !isLieeCeClient) return false;

            if (!search.trim()) return true;
            const q = search.toLowerCase();
            const text = `${r.refTitre} ${r.clientNom || ''} ${r.totalFacture || r.totalTTC || ''}`.toLowerCase();
            return text.includes(q);
        });
    }, [allRecettes, client, search, filterTab]);

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <div>
                        <div style={{ fontWeight: 700, fontSize: 16 }}>
                            Rattacher des factures ou recettes à {client.nom}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                            Affectez les factures et recettes existantes à ce dossier client.
                        </div>
                    </div>
                    <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={onClose}
                        style={{ padding: '4px 8px', fontSize: 14 }}
                    >
                        ✕
                    </button>
                </div>

                <div className="modal-body">
                    <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                        <input
                            type="text"
                            className="form-input"
                            placeholder="Rechercher par référence, libellé, montant..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            style={{ flex: 1, minWidth: 200 }}
                            autoFocus
                        />
                        <div className="view-tabs">
                            <button
                                type="button"
                                className={`view-tab-btn ${filterTab === 'toutes' ? 'view-tab-btn--active' : ''}`}
                                onClick={() => setFilterTab('toutes')}
                                style={{ padding: '4px 10px', fontSize: 12 }}
                            >
                                Toutes ({allRecettes.length})
                            </button>
                            <button
                                type="button"
                                className={`view-tab-btn ${filterTab === 'libres' ? 'view-tab-btn--active' : ''}`}
                                onClick={() => setFilterTab('libres')}
                                style={{ padding: '4px 10px', fontSize: 12 }}
                            >
                                Non rattachées
                            </button>
                            <button
                                type="button"
                                className={`view-tab-btn ${filterTab === 'liees' ? 'view-tab-btn--active' : ''}`}
                                onClick={() => setFilterTab('liees')}
                                style={{ padding: '4px 10px', fontSize: 12 }}
                            >
                                Rattachées à ce client
                            </button>
                        </div>
                    </div>

                    {filtered.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)', fontSize: 13 }}>
                            Aucune facture ou recette trouvée.
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {filtered.map((r) => {
                                const isLieeCeClient = r.clientId === client.id;
                                const isLieeAutre = r.clientId && !isLieeCeClient;
                                const montant = r.totalFacture ?? r.totalTTC ?? r.totalHT ?? 0;

                                return (
                                    <div
                                        key={r.id}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            padding: '10px 14px',
                                            background: isLieeCeClient ? '#ecfdf5' : 'var(--bg2)',
                                            border: `1px solid ${isLieeCeClient ? '#a7f3d0' : 'var(--border)'}`,
                                            borderRadius: 'var(--radius)',
                                            gap: 12,
                                        }}
                                    >
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <span style={{ fontWeight: 600, fontSize: 13 }}>{r.refTitre}</span>
                                                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                                    {formatDate(r.date || r.dateFacture || r.dateFacturation)}
                                                </span>
                                                {isLieeCeClient && (
                                                    <span className="badge badge--success" style={{ fontSize: 10 }}>
                                                        Rattachée à ce client
                                                    </span>
                                                )}
                                                {isLieeAutre && (
                                                    <span className="badge badge--warning" style={{ fontSize: 10 }}>
                                                        Attribuée à {r.clientNom || 'autre'}
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                                            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--success)', whiteSpace: 'nowrap' }}>
                                                + {formatMontant(montant)}
                                            </div>

                                            {isLieeCeClient ? (
                                                <button
                                                    type="button"
                                                    className="btn btn--ghost btn--sm"
                                                    onClick={() => onDetacher(r, r.typeRecette)}
                                                    style={{ color: 'var(--danger)', fontSize: 12 }}
                                                >
                                                    Détacher
                                                </button>
                                            ) : (
                                                <button
                                                    type="button"
                                                    className="btn btn--primary btn--sm"
                                                    onClick={() => onRattacher(r, r.typeRecette)}
                                                    style={{ fontSize: 12 }}
                                                >
                                                    + Rattacher
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className="modal-footer">
                    <button type="button" className="btn btn--primary btn--sm" onClick={onClose}>
                        Fermer
                    </button>
                </div>
            </div>
        </div>
    );
}
