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
import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
    doc, getDoc, getDocs, collection, query, where,
    orderBy, updateDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { ecrireEcriture } from '../services/api';
import { formatMontant, formatDate } from '../services/helpers';
import { getCached, setCached } from '../services/dataCache';

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
    const [depenses, setDepenses] = useState([]);
    const [versementsStripe, setVersementsStripe] = useState([]);
    const [loading, setLoading] = useState(() => {
        const cached = getCached('clients');
        return !cached?.some((c) => c.id === clientId);
    });

    // Modes d'affichage
    const [edit, setEdit] = useState(false);
    const [editForm, setEditForm] = useState({});
    const [saving, setSaving] = useState(false);

    // Modals RDV & Échanges
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
        date: new Date().toISOString().split('T')[0],
        titre: '',
        format: 'visio',
        contenu: '',
    });

    // Nouvelle tâche rapide
    const [newTodoText, setNewTodoText] = useState('');

    useEffect(() => {
        async function loadData() {
            try {
                const [cliSnap, catSnap, factSnap, depSnap1, depSnap2, versSnap] = await Promise.all([
                    getDoc(doc(db, 'clients', clientId)),
                    getDocs(query(collection(db, 'categoriesClient'), orderBy('ordre'))),
                    getDocs(query(collection(db, 'factures'), where('clientId', '==', clientId), orderBy('dateFacture', 'desc'))),
                    getDocs(query(collection(db, 'depenses'), where('clientId', '==', clientId))),
                    getDocs(query(collection(db, 'depenses'), where('clientProjetId', '==', clientId))),
                    getDocs(query(collection(db, 'versementsStripe'), where('clientId', '==', clientId), orderBy('dateVirement', 'desc'))),
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

                const factList = factSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
                setFactures(factList);

                // Dépenses dédoublonnées (clientId ou clientProjetId)
                const depMap = new Map();
                depSnap1.docs.forEach((d) => depMap.set(d.id, { id: d.id, ...d.data() }));
                depSnap2.docs.forEach((d) => depMap.set(d.id, { id: d.id, ...d.data() }));
                const depList = Array.from(depMap.values()).sort((a, b) => {
                    const da = a.dateDépense?.toDate ? a.dateDépense.toDate() : new Date(a.dateDépense || 0);
                    const dbDate = b.dateDépense?.toDate ? b.dateDépense.toDate() : new Date(b.dateDépense || 0);
                    return dbDate - da;
                });
                setDepenses(depList);

                setVersementsStripe(versSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
            } catch (err) {
                console.error('Erreur chargement fiche client:', err);
            } finally {
                setLoading(false);
            }
        }
        loadData();
    }, [clientId, navigate]);

    // ─── Métriques financières ────────────────────────────────────────────────
    const totalFactureTTC = factures.reduce((s, f) => s + (f.totalTTC ?? 0), 0);
    const totalFactureHT = factures.reduce((s, f) => s + (f.totalHT ?? f.totalTTC ?? 0), 0);
    const totalEnAttenteTTC = factures
        .filter((f) => f.statut === 'en_attente')
        .reduce((s, f) => s + (f.totalTTC ?? 0), 0);
    const countEnAttente = factures.filter((f) => f.statut === 'en_attente').length;

    const totalDepensesTTC = depenses.reduce((s, d) => s + (d.montantTTC ?? d.montant ?? 0), 0);
    const totalEncaisseStripe = versementsStripe.reduce((s, v) => s + (v.montantBrut ?? 0), 0);

    // Chiffre d'affaires global pris en compte
    const caGlobal = Math.max(totalFactureTTC, totalEncaisseStripe);
    const margeNette = caGlobal > 0 ? caGlobal - totalDepensesTTC : null;
    const pourcentageMarge = caGlobal > 0 ? (margeNette / caGlobal) * 100 : null;

    const mrr = parseFloat(client?.abonnementMensuelManuel) || 0;

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
            const payload = {
                prochainRdvDate: rdvForm.date,
                prochainRdvHeure: rdvForm.heure || '14:00',
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
    const clientStatutObj = CLIENT_STATUTS.find((s) => s.id === client.statutClient) || CLIENT_STATUTS[0];
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
                        ].filter(Boolean).join('  ·  ')}
                    </div>
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
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
                        onClick={() => navigate(`/factures/nouvelle?clientId=${client.id}`)}
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
                                    <input
                                        type="date"
                                        className="form-input"
                                        value={editForm.siteDateLigne ?? ''}
                                        onChange={(e) => setEditForm((f) => ({ ...f, siteDateLigne: e.target.value }))}
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Échéance renouvellement</label>
                                    <input
                                        type="date"
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
                                        <input
                                            type="date"
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

            {/* ─── Section Inférieure : Facturation & Comptabilité rattachée ─── */}
            <div className="card" style={{ marginTop: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                    <div>
                        <div className="card__title" style={{ margin: 0 }}>
                            Factures émises pour ce client
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                            Historique officiel issu du module de facturation
                        </div>
                    </div>
                    <button
                        type="button"
                        className="btn btn--primary btn--sm"
                        onClick={() => navigate(`/factures/nouvelle?clientId=${client.id}`)}
                    >
                        + Émettre une facture
                    </button>
                </div>

                <div className="table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>Numéro</th>
                                <th>Date</th>
                                <th style={{ textAlign: 'right' }}>Total HT</th>
                                <th style={{ textAlign: 'right' }}>Total TTC</th>
                                <th>Statut</th>
                                <th style={{ textAlign: 'right' }}>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {factures.length === 0 ? (
                                <tr>
                                    <td colSpan={6} style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 24 }}>
                                        Aucune facture émise pour ce client pour le moment.
                                    </td>
                                </tr>
                            ) : (
                                factures.map((f) => (
                                    <tr key={f.id}>
                                        <td style={{ fontWeight: 600 }}>{f.numero}</td>
                                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{formatDate(f.dateFacture)}</td>
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
                                            {f.statut === 'en_attente' && (
                                                <button
                                                    type="button"
                                                    className="btn btn--sm btn--ghost"
                                                    onClick={() => handleMarquerFacturePayee(f)}
                                                >
                                                    Encaisser
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                        {factures.length > 0 && (
                            <tfoot>
                                <tr>
                                    <td colSpan={2}><strong>Total facturé</strong></td>
                                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatMontant(totalFactureHT)}</td>
                                    <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--success)' }}>{formatMontant(totalFactureTTC)}</td>
                                    <td colSpan={2}></td>
                                </tr>
                            </tfoot>
                        )}
                    </table>
                </div>
            </div>

            {/* Dépenses rattachées au projet */}
            {depenses.length > 0 && (
                <div className="card">
                    <div className="card__title" style={{ marginBottom: 12 }}>
                        Dépenses analytiques rattachées à ce projet
                    </div>
                    <div className="table-wrap">
                        <table>
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Fournisseur</th>
                                    <th>Description</th>
                                    <th style={{ textAlign: 'right' }}>Montant TTC</th>
                                    <th>Statut</th>
                                </tr>
                            </thead>
                            <tbody>
                                {depenses.map((d) => (
                                    <tr key={d.id}>
                                        <td style={{ fontSize: 12 }}>{formatDate(d.dateDépense)}</td>
                                        <td style={{ fontWeight: 500 }}>{d.fournisseurNom || '—'}</td>
                                        <td style={{ fontSize: 13, color: 'var(--text-muted)' }}>{d.description}</td>
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
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr>
                                    <td colSpan={3}><strong>Total dépenses projet</strong></td>
                                    <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--danger)' }}>
                                        − {formatMontant(totalDepensesTTC)}
                                    </td>
                                    <td></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            )}

            {/* ─── Modal Planifier / Modifier Rendez-vous ─── */}
            {showRdvModal && (
                <div style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    zIndex: 1000, padding: 20,
                }}>
                    <div className="card" style={{ maxWidth: 460, width: '100%', padding: 24, boxShadow: 'var(--shadow-md)' }}>
                        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>
                            {client.prochainRdvDate ? 'Modifier le rendez-vous' : 'Planifier un rendez-vous'}
                        </div>

                        <div className="form-row">
                            <div className="form-group">
                                <label className="form-label">Date *</label>
                                <input
                                    type="date"
                                    className="form-input"
                                    value={rdvForm.date}
                                    onChange={(e) => setRdvForm((f) => ({ ...f, date: e.target.value }))}
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Heure *</label>
                                <input
                                    type="time"
                                    className="form-input"
                                    value={rdvForm.heure}
                                    onChange={(e) => setRdvForm((f) => ({ ...f, heure: e.target.value }))}
                                />
                            </div>
                        </div>

                        <div className="form-group">
                            <label className="form-label">Format de l'échange</label>
                            <select
                                className="form-select"
                                value={rdvForm.format}
                                onChange={(e) => setRdvForm((f) => ({ ...f, format: e.target.value }))}
                            >
                                {RDV_FORMATS.map((f) => (
                                    <option key={f.id} value={f.id}>{f.label}</option>
                                ))}
                            </select>
                        </div>

                        <div className="form-group">
                            <label className="form-label">Objet de la réunion *</label>
                            <input
                                type="text"
                                className="form-input"
                                placeholder="Ex. Validation maquette accueil, point d'étape..."
                                value={rdvForm.objet}
                                onChange={(e) => setRdvForm((f) => ({ ...f, objet: e.target.value }))}
                            />
                        </div>

                        <div className="form-group">
                            <label className="form-label">Lien de visioconférence ou adresse</label>
                            <input
                                type="text"
                                className="form-input"
                                placeholder="https://meet.google.com/... ou adresse"
                                value={rdvForm.lien}
                                onChange={(e) => setRdvForm((f) => ({ ...f, lien: e.target.value }))}
                            />
                        </div>

                        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
                            <button
                                type="button"
                                className="btn btn--ghost"
                                onClick={() => setShowRdvModal(false)}
                            >
                                Annuler
                            </button>
                            <button
                                type="button"
                                className="btn btn--primary"
                                disabled={saving || !rdvForm.date || !rdvForm.objet.trim()}
                                onClick={handleSaveRdv}
                            >
                                {saving ? 'Enregistrement...' : 'Confirmer le rendez-vous'}
                            </button>
                        </div>
                    </div>
                </div>
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
        </div>
    );
}
