/**
 * Clients.jsx — Espace Clients & Sites Internet (Style ClickUp)
 * 
 * Vues disponibles :
 * 1. Tableau : Liste détaillée et condensée avec métriques financières et accès direct
 * 2. Kanban : Tableau visuel en colonnes (groupé par statut web ou par catégorie)
 * 3. Rentabilité : Vue analytique complète avec KPIs globaux et classement de rentabilité
 * 
 * Contrainte stricte : AUCUN EMOJI. Design sobre, épuré, haute densité d'information.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    collection, query, orderBy, getDocs,
    doc, updateDoc, serverTimestamp, addDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import { formatMontant, formatDate } from '../services/helpers';
import { getCached, setCached } from '../services/dataCache';
import { SITE_STATUTS, getStatutClient } from '../services/clientConstants';

function Spinner() {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-muted)', padding: '32px 0' }}>
            <div style={{
                width: 20, height: 20, borderRadius: '50%',
                border: '2px solid var(--border)',
                borderTopColor: 'var(--accent)',
                animation: 'spin 0.7s linear infinite',
                flexShrink: 0,
            }} />
            Chargement des clients et données financières...
        </div>
    );
}

export default function Clients() {
    const navigate = useNavigate();

    // Vues ClickUp : 'tableau' | 'kanban' | 'rentabilite'
    const [currentView, setCurrentView] = useState('tableau');
    const [kanbanGroupBy, setKanbanGroupBy] = useState('statut'); // 'statut' | 'categorie'
    const [rentabiliteFiltre, setRentabiliteFiltre] = useState('tous'); // 'tous' | 'rentables' | 'deficitaires' | 'non_factures'

    // Données principales
    const [clients, setClients] = useState(() => getCached('clients') || []);
    const [categories, setCategories] = useState(() => getCached('categoriesClient') || []);
    const [loading, setLoading] = useState(() => !getCached('clients'));

    // Filtres & Recherche
    const [search, setSearch] = useState('');
    const [catFiltreId, setCatFiltreId] = useState('');
    const [statutFiltre, setStatutFiltre] = useState('');

    // Modal nouveau client
    const [showNewModal, setShowNewModal] = useState(false);
    const [newClient, setNewClient] = useState({
        nom: '',
        contactPrenom: '',
        contactNom: '',
        contactRole: '',
        email: '',
        telephone: '',
        siteUrl: '',
        siteStatut: 'en_ligne',
        siteType: 'vitrine',
        siteStack: '',
        siteHebergeur: '',
        categorieId: '',
        abonnementMensuelManuel: '',
    });
    const [saving, setSaving] = useState(false);

    // Chargement complet et parallèle (clients, factures, facturations, versements, dépenses)
    const load = useCallback(async () => {
        try {
            const [cliSnap, catSnap, factSnap, factuSnap, depSnap, versSnap] = await Promise.all([
                getDocs(query(collection(db, 'clients'), orderBy('nom'))),
                getDocs(query(collection(db, 'categoriesClient'), orderBy('ordre'))),
                getDocs(collection(db, 'factures')),
                getDocs(collection(db, 'facturations')),
                getDocs(collection(db, 'depenses')),
                getDocs(collection(db, 'versementsStripe')),
            ]);

            const cats = catSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
            setCategories(cats);
            setCached('categoriesClient', cats);

            const facts = factSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
            const factus = factuSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
            const deps = depSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
            const versements = versSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

            const clientsList = cliSnap.docs.map((d) => {
                const data = d.data();
                const cId = d.id;
                const cNom = (data.nom || '').trim().toLowerCase();

                // 1. Factures rattachées (collection 'factures')
                const facturesClient = facts.filter((f) =>
                    f.clientId === cId || (cNom && f.clientNom && f.clientNom.trim().toLowerCase() === cNom)
                );
                const totalFactures = facturesClient.reduce((s, f) => s + (f.totalTTC ?? f.totalFacture ?? 0), 0);

                // 2. Facturations rattachées (collection 'facturations')
                const facturationsClient = factus.filter((f) =>
                    f.clientId === cId || (cNom && f.clientNom && f.clientNom.trim().toLowerCase() === cNom)
                );
                const totalFacturations = facturationsClient.reduce((s, f) => s + (f.totalFacture ?? f.totalTTC ?? f.montant ?? 0), 0);

                // Total CA facturé combiné
                const totalFacture = totalFactures + totalFacturations;

                // 3. Versements Stripe
                const versClient = versements.filter((v) =>
                    v.clientId === cId || (cNom && v.clientNom && v.clientNom.trim().toLowerCase() === cNom)
                );
                const totalStripe = versClient.reduce((s, v) => s + (v.montantBrut ?? 0), 0);

                // Estimation abonnement Stripe
                let aboStripe = 0;
                versClient.forEach((v) => {
                    if (v.recurrence?.type === 'recurrent' && v.abonnementMensuelEstime) {
                        aboStripe = Math.max(aboStripe, v.abonnementMensuelEstime);
                    }
                });

                // CA total estimé / encaissé
                const totalEncaisse = Math.max(totalFacture, totalStripe);

                // MRR
                const mrr = data.abonnementMensuelManuel
                    ? parseFloat(data.abonnementMensuelManuel) || 0
                    : aboStripe;

                // 4. Dépenses rattachées
                const depensesClient = deps.filter((dp) =>
                    dp.clientProjetId === cId ||
                    dp.clientId === cId ||
                    (cNom && dp.clientProjetNom && dp.clientProjetNom.trim().toLowerCase() === cNom) ||
                    (cNom && dp.clientNom && dp.clientNom.trim().toLowerCase() === cNom)
                );
                const totalDepenses = depensesClient.reduce((s, dp) => s + (dp.montantTTC ?? dp.montant ?? dp.montantHT ?? 0), 0);

                // Marge brute & nette
                const baseCA = totalFacture > 0 ? totalFacture : totalEncaisse;
                const margeNette = baseCA - totalDepenses;
                const pourcentageMarge = baseCA > 0 ? Math.round((margeNette / baseCA) * 100) : (totalDepenses > 0 ? -100 : 0);

                return {
                    id: cId,
                    ...data,
                    siteStatut: data.siteStatut || 'en_ligne',
                    totalFacture,
                    totalEncaisse,
                    totalDepenses,
                    margeNette,
                    pourcentageMarge,
                    abonnementMensuel: mrr,
                    nbFactures: facturesClient.length + facturationsClient.length,
                    nbDepenses: depensesClient.length,
                };
            });

            setClients(clientsList);
            setCached('clients', clientsList);
        } catch (err) {
            console.error('Erreur chargement clients:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    // Filtrage multi-critères
    const filtered = useMemo(() => {
        return clients.filter((c) => {
            const q = search.trim().toLowerCase();
            const matchSearch = !q || (
                c.nom?.toLowerCase().includes(q) ||
                c.contactNom?.toLowerCase().includes(q) ||
                c.contactPrenom?.toLowerCase().includes(q) ||
                c.email?.toLowerCase().includes(q) ||
                c.siteUrl?.toLowerCase().includes(q) ||
                c.siteHebergeur?.toLowerCase().includes(q)
            );
            const matchCat = !catFiltreId || (
                catFiltreId === '__none__' ? !c.categorieId : c.categorieId === catFiltreId
            );
            const matchStatut = !statutFiltre || c.siteStatut === statutFiltre;

            return matchSearch && matchCat && matchStatut;
        });
    }, [clients, search, catFiltreId, statutFiltre]);

    // Métriques globales consolidées
    const metrics = useMemo(() => {
        const totalFacture = filtered.reduce((s, c) => s + (c.totalFacture || c.totalEncaisse || 0), 0);
        const totalDepenses = filtered.reduce((s, c) => s + (c.totalDepenses || 0), 0);
        const margeNette = totalFacture - totalDepenses;
        const margeTaux = totalFacture > 0 ? Math.round((margeNette / totalFacture) * 100) : 0;
        const totalMRR = filtered.reduce((s, c) => s + (c.abonnementMensuel || 0), 0);

        return { totalFacture, totalDepenses, margeNette, margeTaux, totalMRR };
    }, [filtered]);

    // Changement rapide de statut de site (optimiste 0 ms)
    async function changerStatutSite(clientId, newStatut) {
        setClients((prev) => {
            const next = prev.map((c) => (c.id === clientId ? { ...c, siteStatut: newStatut } : c));
            setCached('clients', next);
            return next;
        });

        try {
            await updateDoc(doc(db, 'clients', clientId), {
                siteStatut: newStatut,
                updatedAt: serverTimestamp(),
            });
        } catch (err) {
            console.error('Erreur mise à jour statut client:', err);
            load();
        }
    }

    // Changement rapide de catégorie (optimiste 0 ms)
    async function changerCategorie(clientId, catId) {
        const cat = categories.find((c) => c.id === catId);

        setClients((prev) => {
            const next = prev.map((c) =>
                c.id === clientId
                    ? { ...c, categorieId: catId || null, categorieNom: cat?.nom || null }
                    : c
            );
            setCached('clients', next);
            return next;
        });

        try {
            await updateDoc(doc(db, 'clients', clientId), {
                categorieId: catId || null,
                categorieNom: cat?.nom || null,
                updatedAt: serverTimestamp(),
            });
        } catch (err) {
            console.error('Erreur mise à jour catégorie client:', err);
            load();
        }
    }

    // Création client
    async function creerClient(e) {
        e.preventDefault();
        const nom = newClient.nom.trim();
        if (!nom) return;

        setSaving(true);
        const tempId = 'temp_' + Date.now();
        const catObj = categories.find((cat) => cat.id === newClient.categorieId);

        const clientToAdd = {
            id: tempId,
            nom,
            contactPrenom: newClient.contactPrenom.trim(),
            contactNom: newClient.contactNom.trim(),
            contactRole: newClient.contactRole.trim(),
            email: newClient.email.trim(),
            telephone: newClient.telephone.trim(),
            siteUrl: newClient.siteUrl.trim(),
            siteStatut: newClient.siteStatut || 'en_ligne',
            siteType: newClient.siteType || 'vitrine',
            siteStack: newClient.siteStack.trim(),
            siteHebergeur: newClient.siteHebergeur.trim(),
            categorieId: newClient.categorieId || null,
            categorieNom: catObj?.nom || null,
            abonnementMensuelManuel: parseFloat(newClient.abonnementMensuelManuel) || 0,
            totalFacture: 0,
            totalEncaisse: 0,
            totalDepenses: 0,
            margeNette: 0,
            pourcentageMarge: 0,
            abonnementMensuel: parseFloat(newClient.abonnementMensuelManuel) || 0,
            taches: [],
            historiqueEchanges: [],
        };

        setClients((prev) => {
            const next = [clientToAdd, ...prev].sort((a, b) => (a.nom || '').localeCompare(b.nom || ''));
            setCached('clients', next);
            return next;
        });
        setShowNewModal(false);

        setNewClient({
            nom: '',
            contactPrenom: '',
            contactNom: '',
            contactRole: '',
            email: '',
            telephone: '',
            siteUrl: '',
            siteStatut: 'en_ligne',
            siteType: 'vitrine',
            siteStack: '',
            siteHebergeur: '',
            categorieId: '',
            abonnementMensuelManuel: '',
        });

        try {
            const docRef = await addDoc(collection(db, 'clients'), {
                nom,
                contactPrenom: clientToAdd.contactPrenom,
                contactNom: clientToAdd.contactNom,
                contactRole: clientToAdd.contactRole,
                email: clientToAdd.email,
                telephone: clientToAdd.telephone,
                siteUrl: clientToAdd.siteUrl,
                siteStatut: clientToAdd.siteStatut,
                siteType: clientToAdd.siteType,
                siteStack: clientToAdd.siteStack,
                siteHebergeur: clientToAdd.siteHebergeur,
                categorieId: clientToAdd.categorieId,
                categorieNom: clientToAdd.categorieNom,
                abonnementMensuelManuel: clientToAdd.abonnementMensuelManuel,
                taches: [],
                historiqueEchanges: [],
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });

            setClients((prev) => {
                const next = prev.map((c) => (c.id === tempId ? { ...c, id: docRef.id } : c));
                setCached('clients', next);
                return next;
            });
        } catch (err) {
            console.error('Erreur création client:', err);
            load();
        } finally {
            setSaving(false);
        }
    }

    const catMap = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c])), [categories]);

    // Classement rentabilité
    const rentabiliteClients = useMemo(() => {
        let list = [...filtered].sort((a, b) => (b.margeNette || 0) - (a.margeNette || 0));
        if (rentabiliteFiltre === 'rentables') {
            list = list.filter((c) => (c.margeNette || 0) > 0);
        } else if (rentabiliteFiltre === 'deficitaires') {
            list = list.filter((c) => (c.margeNette || 0) < 0);
        } else if (rentabiliteFiltre === 'non_factures') {
            list = list.filter((c) => (c.totalFacture || 0) === 0);
        }
        return list;
    }, [filtered, rentabiliteFiltre]);

    return (
        <div>
            {/* Header de la page */}
            <div className="page-header">
                <div>
                    <h1 style={{ margin: 0 }}>Clients & Sites</h1>
                    <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>
                        Espace de pilotage opérationnel, suivi des sites, facturation et rentabilité analytique.
                    </p>
                </div>
                <div className="page-header__actions">
                    <button className="btn btn--primary" onClick={() => setShowNewModal(true)}>
                        + Nouveau client
                    </button>
                    <button className="btn btn--ghost" onClick={() => navigate('/clients/categories')}>
                        Catégories
                    </button>
                </div>
            </div>

            {/* Barre de vues style ClickUp */}
            <div className="view-tabs">
                <button
                    type="button"
                    className={`view-tab-btn ${currentView === 'tableau' ? 'view-tab-btn--active' : ''}`}
                    onClick={() => setCurrentView('tableau')}
                >
                    Tableau
                    <span className="view-tab-badge">{filtered.length}</span>
                </button>
                <button
                    type="button"
                    className={`view-tab-btn ${currentView === 'kanban' ? 'view-tab-btn--active' : ''}`}
                    onClick={() => setCurrentView('kanban')}
                >
                    Kanban
                    <span className="view-tab-badge">{filtered.length}</span>
                </button>
                <button
                    type="button"
                    className={`view-tab-btn ${currentView === 'rentabilite' ? 'view-tab-btn--active' : ''}`}
                    onClick={() => setCurrentView('rentabilite')}
                >
                    Rentabilité & Marges
                </button>
            </div>

            {/* Filtres & Recherche (disponibles sur toutes les vues) */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                    type="text"
                    className="form-input"
                    placeholder="Rechercher par nom, site, contact, hébergeur..."
                    style={{ maxWidth: 290 }}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
                <select
                    className="form-select"
                    style={{ maxWidth: 190 }}
                    value={catFiltreId}
                    onChange={(e) => setCatFiltreId(e.target.value)}
                >
                    <option value="">Toutes catégories</option>
                    <option value="__none__">Non catégorisé</option>
                    {categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.nom}</option>
                    ))}
                </select>
                <select
                    className="form-select"
                    style={{ maxWidth: 180 }}
                    value={statutFiltre}
                    onChange={(e) => setStatutFiltre(e.target.value)}
                >
                    <option value="">Tous les statuts web</option>
                    {SITE_STATUTS.map((s) => (
                        <option key={s.id} value={s.id}>{s.label}</option>
                    ))}
                </select>
                {(search || catFiltreId || statutFiltre) && (
                    <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => { setSearch(''); setCatFiltreId(''); setStatutFiltre(''); }}
                    >
                        Réinitialiser
                    </button>
                )}

                {/* Sélecteur de regroupement spécifique au Kanban */}
                {currentView === 'kanban' && (
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                        <span style={{ color: 'var(--text-muted)' }}>Grouper par :</span>
                        <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                            <button
                                type="button"
                                style={{
                                    padding: '5px 10px', fontSize: 12, border: 'none', cursor: 'pointer',
                                    background: kanbanGroupBy === 'statut' ? 'var(--accent)' : 'var(--bg2)',
                                    color: kanbanGroupBy === 'statut' ? '#fff' : 'var(--text)',
                                    fontWeight: 500,
                                }}
                                onClick={() => setKanbanGroupBy('statut')}
                            >
                                Statut du site
                            </button>
                            <button
                                type="button"
                                style={{
                                    padding: '5px 10px', fontSize: 12, border: 'none', borderLeft: '1px solid var(--border)', cursor: 'pointer',
                                    background: kanbanGroupBy === 'categorie' ? 'var(--accent)' : 'var(--bg2)',
                                    color: kanbanGroupBy === 'categorie' ? '#fff' : 'var(--text)',
                                    fontWeight: 500,
                                }}
                                onClick={() => setKanbanGroupBy('categorie')}
                            >
                                Catégories
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {loading && <Spinner />}

            {/* ═══════════════════════════════════════════════════════════════════
                VUE 1 : TABLEAU
            ════════════════════════════════════════════════════════════════════ */}
            {!loading && currentView === 'tableau' && (
                <>
                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                        <div className="table-wrap">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Client & Contact</th>
                                        <th>Site Internet & Statut</th>
                                        <th>Prochain RDV</th>
                                        <th>Catégorie</th>
                                        <th style={{ textAlign: 'right' }}>Total facturé</th>
                                        <th style={{ textAlign: 'right' }}>Dépenses</th>
                                        <th style={{ textAlign: 'right' }}>Marge nette</th>
                                        <th style={{ textAlign: 'right' }}>MRR</th>
                                        <th style={{ textAlign: 'right' }}>Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filtered.length === 0 && (
                                        <tr>
                                            <td colSpan={9} style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 32 }}>
                                                Aucun client ne correspond à votre recherche.
                                            </td>
                                        </tr>
                                    )}
                                    {filtered.map((c) => {
                                        const cat = catMap[c.categorieId];
                                        const siteStatut = getStatutClient(c.siteStatut);
                                        const contactComplet = [c.contactPrenom, c.contactNom].filter(Boolean).join(' ');

                                        return (
                                            <tr
                                                key={c.id}
                                                style={{ cursor: 'pointer' }}
                                                onClick={() => navigate(`/clients/${c.id}`)}
                                            >
                                                {/* Client & Contact */}
                                                <td>
                                                    <div style={{ fontWeight: 600, color: 'var(--text)' }}>{c.nom}</div>
                                                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                                                        {contactComplet ? (
                                                            <span>{contactComplet}{c.contactRole ? ` (${c.contactRole})` : ''}</span>
                                                        ) : (
                                                            c.email || '—'
                                                        )}
                                                    </div>
                                                </td>

                                                {/* Site & Statut */}
                                                <td>
                                                    {c.siteUrl ? (
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                                                            <a
                                                                href={c.siteUrl.startsWith('http') ? c.siteUrl : `https://${c.siteUrl}`}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                style={{ fontWeight: 500, fontSize: 13, color: 'var(--accent)' }}
                                                                onClick={(e) => e.stopPropagation()}
                                                            >
                                                                {c.siteUrl.replace(/^https?:\/\//, '')} [↗]
                                                            </a>
                                                            <div onClick={(e) => e.stopPropagation()}>
                                                                <select
                                                                    className="form-select"
                                                                    style={{
                                                                        fontSize: 10, padding: '1px 6px', height: 'auto',
                                                                        borderColor: siteStatut.color,
                                                                        color: siteStatut.color,
                                                                        background: siteStatut.bg,
                                                                    }}
                                                                    value={c.siteStatut}
                                                                    onChange={(e) => changerStatutSite(c.id, e.target.value)}
                                                                >
                                                                    {SITE_STATUTS.map((s) => (
                                                                        <option key={s.id} value={s.id}>{s.label}</option>
                                                                    ))}
                                                                </select>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Non configuré</span>
                                                    )}
                                                </td>

                                                {/* Prochain RDV */}
                                                <td>
                                                    {c.prochainRdvDate ? (
                                                        <div>
                                                            <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--text)' }}>
                                                                {formatDate(c.prochainRdvDate)} {c.prochainRdvHeure ? `à ${c.prochainRdvHeure}` : ''}
                                                            </div>
                                                            <div style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 150 }}>
                                                                {c.prochainRdvObjet || 'Point client'}
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <span style={{ color: 'var(--text-light)', fontSize: 12 }}>—</span>
                                                    )}
                                                </td>

                                                {/* Catégorie */}
                                                <td onClick={(e) => e.stopPropagation()}>
                                                    <select
                                                        className="form-select"
                                                        style={{
                                                            maxWidth: 140, padding: '3px 6px', fontSize: 12,
                                                            ...(cat ? { borderColor: cat.couleur, color: cat.couleur } : {}),
                                                        }}
                                                        value={c.categorieId ?? ''}
                                                        onChange={(e) => changerCategorie(c.id, e.target.value)}
                                                    >
                                                        <option value="">Non catégorisé</option>
                                                        {categories.map((item) => (
                                                            <option key={item.id} value={item.id}>{item.nom}</option>
                                                        ))}
                                                    </select>
                                                </td>

                                                {/* Total Facturé */}
                                                <td style={{ textAlign: 'right', fontWeight: 600 }}>
                                                    {c.totalFacture > 0 ? (
                                                        formatMontant(c.totalFacture)
                                                    ) : c.totalEncaisse > 0 ? (
                                                        <span style={{ color: 'var(--text-muted)' }}>{formatMontant(c.totalEncaisse)}</span>
                                                    ) : (
                                                        '—'
                                                    )}
                                                </td>

                                                {/* Dépenses */}
                                                <td style={{ textAlign: 'right', color: c.totalDepenses > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>
                                                    {c.totalDepenses > 0 ? `− ${formatMontant(c.totalDepenses)}` : '—'}
                                                </td>

                                                {/* Marge Nette */}
                                                <td style={{ textAlign: 'right', fontWeight: 700 }}>
                                                    {c.totalFacture > 0 || c.totalDepenses > 0 ? (
                                                        <div style={{ color: c.margeNette >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                                                            {formatMontant(c.margeNette)}
                                                            <div style={{ fontSize: 10, fontWeight: 500, opacity: 0.8 }}>
                                                                {c.pourcentageMarge}%
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>—</span>
                                                    )}
                                                </td>

                                                {/* MRR */}
                                                <td style={{ textAlign: 'right', color: c.abonnementMensuel > 0 ? 'var(--accent)' : 'var(--text-muted)', fontWeight: 500 }}>
                                                    {c.abonnementMensuel > 0 ? `${formatMontant(c.abonnementMensuel)} /m` : '—'}
                                                </td>

                                                {/* Action */}
                                                <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                                                    <button
                                                        type="button"
                                                        className="btn btn--sm btn--ghost"
                                                        onClick={() => navigate(`/clients/${c.id}`)}
                                                    >
                                                        Fiche
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Synthèse en bas de page */}
                    {filtered.length > 0 && (
                        <div style={{ marginTop: 14, display: 'flex', gap: 24, fontSize: 13, color: 'var(--text-muted)', flexWrap: 'wrap', padding: '0 4px' }}>
                            <span>
                                Clients : <strong style={{ color: 'var(--text)' }}>{filtered.length}</strong>
                            </span>
                            <span>
                                Total facturé : <strong style={{ color: 'var(--text)' }}>{formatMontant(metrics.totalFacture)}</strong>
                            </span>
                            <span>
                                Dépenses imputées : <strong style={{ color: 'var(--danger)' }}>− {formatMontant(metrics.totalDepenses)}</strong>
                            </span>
                            <span>
                                Marge nette : <strong style={{ color: metrics.margeNette >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                                    {formatMontant(metrics.margeNette)} ({metrics.margeTaux}%)
                                </strong>
                            </span>
                            <span>
                                MRR récurrent : <strong style={{ color: 'var(--accent)' }}>{formatMontant(metrics.totalMRR)} / mois</strong>
                            </span>
                        </div>
                    )}
                </>
            )}

            {/* ═══════════════════════════════════════════════════════════════════
                VUE 2 : KANBAN (Board style ClickUp)
            ════════════════════════════════════════════════════════════════════ */}
            {!loading && currentView === 'kanban' && (
                <div className="kanban-board">
                    {kanbanGroupBy === 'statut' ? (
                        // Kanban groupé par statut de site internet
                        SITE_STATUTS.map((statut) => {
                            const columnClients = filtered.filter((c) => c.siteStatut === statut.id);
                            const caColonne = columnClients.reduce((s, c) => s + (c.totalFacture || c.totalEncaisse || 0), 0);

                            return (
                                <div key={statut.id} className="kanban-column">
                                    <div className="kanban-column-header">
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: statut.color }} />
                                            <span style={{ fontWeight: 600, fontSize: 13 }}>{statut.label}</span>
                                            <span className="badge badge--muted" style={{ fontSize: 11 }}>{columnClients.length}</span>
                                        </div>
                                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>
                                            {formatMontant(caColonne)}
                                        </div>
                                    </div>

                                    <div className="kanban-column-body">
                                        {columnClients.length === 0 ? (
                                            <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                                                Aucun client
                                            </div>
                                        ) : (
                                            columnClients.map((c) => {
                                                const cat = catMap[c.categorieId];
                                                const contactComplet = [c.contactPrenom, c.contactNom].filter(Boolean).join(' ');

                                                return (
                                                    <div
                                                        key={c.id}
                                                        className="kanban-card"
                                                        onClick={() => navigate(`/clients/${c.id}`)}
                                                    >
                                                        {/* Header de la carte */}
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                                                            <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>
                                                                {c.nom}
                                                            </div>
                                                            {cat && (
                                                                <span
                                                                    className="badge"
                                                                    style={{
                                                                        fontSize: 10,
                                                                        background: cat.couleur + '18',
                                                                        color: cat.couleur,
                                                                        border: `1px solid ${cat.couleur}44`,
                                                                    }}
                                                                >
                                                                    {cat.nom}
                                                                </span>
                                                            )}
                                                        </div>

                                                        {/* Site internet */}
                                                        {c.siteUrl && (
                                                            <a
                                                                href={c.siteUrl.startsWith('http') ? c.siteUrl : `https://${c.siteUrl}`}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 500 }}
                                                                onClick={(e) => e.stopPropagation()}
                                                            >
                                                                {c.siteUrl.replace(/^https?:\/\//, '')} [↗]
                                                            </a>
                                                        )}

                                                        {/* Contact & Prochain RDV */}
                                                        <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                                                            {contactComplet && <span>Contact : {contactComplet}</span>}
                                                            {c.prochainRdvDate && (
                                                                <span style={{ color: 'var(--text)', fontWeight: 500 }}>
                                                                    RDV : {formatDate(c.prochainRdvDate)} {c.prochainRdvHeure ? `à ${c.prochainRdvHeure}` : ''}
                                                                </span>
                                                            )}
                                                        </div>

                                                        {/* Métriques financières */}
                                                        <div className="kanban-card-metrics">
                                                            <div>
                                                                <div style={{ color: 'var(--text-muted)' }}>Facturé</div>
                                                                <div style={{ fontWeight: 600 }}>{formatMontant(c.totalFacture)}</div>
                                                            </div>
                                                            <div>
                                                                <div style={{ color: 'var(--text-muted)' }}>Dépenses</div>
                                                                <div style={{ fontWeight: 600, color: c.totalDepenses > 0 ? 'var(--danger)' : 'var(--text)' }}>
                                                                    {c.totalDepenses > 0 ? `− ${formatMontant(c.totalDepenses)}` : '0,00 €'}
                                                                </div>
                                                            </div>
                                                            <div>
                                                                <div style={{ color: 'var(--text-muted)' }}>Marge</div>
                                                                <div style={{ fontWeight: 700, color: c.margeNette >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                                                                    {formatMontant(c.margeNette)}
                                                                </div>
                                                            </div>
                                                            <div>
                                                                <div style={{ color: 'var(--text-muted)' }}>MRR</div>
                                                                <div style={{ fontWeight: 600, color: c.abonnementMensuel > 0 ? 'var(--accent)' : 'var(--text-muted)' }}>
                                                                    {c.abonnementMensuel > 0 ? `${formatMontant(c.abonnementMensuel)}/m` : '—'}
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Sélecteur rapide pour changer de colonne */}
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }} onClick={(e) => e.stopPropagation()}>
                                                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Déplacer :</span>
                                                            <select
                                                                className="form-select"
                                                                style={{ fontSize: 11, padding: '2px 6px', height: 'auto', maxWidth: 140 }}
                                                                value={c.siteStatut}
                                                                onChange={(e) => changerStatutSite(c.id, e.target.value)}
                                                            >
                                                                {SITE_STATUTS.map((st) => (
                                                                    <option key={st.id} value={st.id}>{st.label}</option>
                                                                ))}
                                                            </select>
                                                        </div>
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>
                                </div>
                            );
                        })
                    ) : (
                        // Kanban groupé par Catégorie
                        [...categories, { id: '__none__', nom: 'Non catégorisé', couleur: '#6b7280' }].map((cat) => {
                            const columnClients = filtered.filter((c) =>
                                cat.id === '__none__' ? !c.categorieId : c.categorieId === cat.id
                            );
                            const caColonne = columnClients.reduce((s, c) => s + (c.totalFacture || c.totalEncaisse || 0), 0);

                            return (
                                <div key={cat.id} className="kanban-column">
                                    <div className="kanban-column-header">
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: cat.couleur }} />
                                            <span style={{ fontWeight: 600, fontSize: 13 }}>{cat.nom}</span>
                                            <span className="badge badge--muted" style={{ fontSize: 11 }}>{columnClients.length}</span>
                                        </div>
                                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>
                                            {formatMontant(caColonne)}
                                        </div>
                                    </div>

                                    <div className="kanban-column-body">
                                        {columnClients.length === 0 ? (
                                            <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                                                Aucun client
                                            </div>
                                        ) : (
                                            columnClients.map((c) => {
                                                const siteStatut = getStatutClient(c.siteStatut);

                                                return (
                                                    <div
                                                        key={c.id}
                                                        className="kanban-card"
                                                        onClick={() => navigate(`/clients/${c.id}`)}
                                                    >
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                                                            <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>
                                                                {c.nom}
                                                            </div>
                                                            <span
                                                                className="badge"
                                                                style={{
                                                                    fontSize: 10,
                                                                    background: siteStatut.bg,
                                                                    color: siteStatut.color,
                                                                    border: `1px solid ${siteStatut.color}44`,
                                                                }}
                                                            >
                                                                {siteStatut.label}
                                                            </span>
                                                        </div>

                                                        {c.siteUrl && (
                                                            <a
                                                                href={c.siteUrl.startsWith('http') ? c.siteUrl : `https://${c.siteUrl}`}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 500 }}
                                                                onClick={(e) => e.stopPropagation()}
                                                            >
                                                                {c.siteUrl.replace(/^https?:\/\//, '')} [↗]
                                                            </a>
                                                        )}

                                                        <div className="kanban-card-metrics">
                                                            <div>
                                                                <div style={{ color: 'var(--text-muted)' }}>Facturé</div>
                                                                <div style={{ fontWeight: 600 }}>{formatMontant(c.totalFacture)}</div>
                                                            </div>
                                                            <div>
                                                                <div style={{ color: 'var(--text-muted)' }}>Marge</div>
                                                                <div style={{ fontWeight: 700, color: c.margeNette >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                                                                    {formatMontant(c.margeNette)}
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Déplacer de catégorie */}
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }} onClick={(e) => e.stopPropagation()}>
                                                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Catégorie :</span>
                                                            <select
                                                                className="form-select"
                                                                style={{ fontSize: 11, padding: '2px 6px', height: 'auto', maxWidth: 140 }}
                                                                value={c.categorieId ?? ''}
                                                                onChange={(e) => changerCategorie(c.id, e.target.value)}
                                                            >
                                                                <option value="">Non catégorisé</option>
                                                                {categories.map((item) => (
                                                                    <option key={item.id} value={item.id}>{item.nom}</option>
                                                                ))}
                                                            </select>
                                                        </div>
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            )}

            {/* ═══════════════════════════════════════════════════════════════════
                VUE 3 : RENTABILITÉ & ANALYTICS
            ════════════════════════════════════════════════════════════════════ */}
            {!loading && currentView === 'rentabilite' && (
                <div>
                    {/* Grille de KPIs financiers */}
                    <div className="rentabilite-grid">
                        <div className="rentabilite-kpi">
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                CA Total Facturé
                            </div>
                            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', marginTop: 6 }}>
                                {formatMontant(metrics.totalFacture)}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                                Sur {filtered.length} clients sélectionnés
                            </div>
                        </div>

                        <div className="rentabilite-kpi">
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                Dépenses Directes Affectées
                            </div>
                            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--danger)', marginTop: 6 }}>
                                − {formatMontant(metrics.totalDepenses)}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                                Coûts d'hébergement, licences & prestataires
                            </div>
                        </div>

                        <div className="rentabilite-kpi">
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                Marge Nette Globale
                            </div>
                            <div style={{ fontSize: 22, fontWeight: 700, color: metrics.margeNette >= 0 ? 'var(--success)' : 'var(--danger)', marginTop: 6 }}>
                                {formatMontant(metrics.margeNette)}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                                Taux de marge moyen : <strong>{metrics.margeTaux}%</strong>
                            </div>
                        </div>

                        <div className="rentabilite-kpi">
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                Revenu Récurrent (MRR)
                            </div>
                            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--accent)', marginTop: 6 }}>
                                {formatMontant(metrics.totalMRR)} /m
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                                Soit {formatMontant(metrics.totalMRR * 12)} / an
                            </div>
                        </div>
                    </div>

                    {/* Filtres de classement */}
                    <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center' }}>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Filtrer le classement :</span>
                        <button
                            type="button"
                            className={`btn btn--sm ${rentabiliteFiltre === 'tous' ? 'btn--primary' : 'btn--ghost'}`}
                            onClick={() => setRentabiliteFiltre('tous')}
                        >
                            Tous ({filtered.length})
                        </button>
                        <button
                            type="button"
                            className={`btn btn--sm ${rentabiliteFiltre === 'rentables' ? 'btn--primary' : 'btn--ghost'}`}
                            onClick={() => setRentabiliteFiltre('rentables')}
                        >
                            Rentables ({filtered.filter((c) => c.margeNette > 0).length})
                        </button>
                        <button
                            type="button"
                            className={`btn btn--sm ${rentabiliteFiltre === 'deficitaires' ? 'btn--primary' : 'btn--ghost'}`}
                            onClick={() => setRentabiliteFiltre('deficitaires')}
                        >
                            Déficitaires ({filtered.filter((c) => c.margeNette < 0).length})
                        </button>
                        <button
                            type="button"
                            className={`btn btn--sm ${rentabiliteFiltre === 'non_factures' ? 'btn--primary' : 'btn--ghost'}`}
                            onClick={() => setRentabiliteFiltre('non_factures')}
                        >
                            Sans facturation ({filtered.filter((c) => (c.totalFacture || 0) === 0).length})
                        </button>
                    </div>

                    {/* Tableau de classement de rentabilité */}
                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                        <div className="table-wrap">
                            <table>
                                <thead>
                                    <tr>
                                        <th style={{ width: 50 }}>Rang</th>
                                        <th>Client & Site</th>
                                        <th>Catégorie</th>
                                        <th style={{ textAlign: 'right' }}>Total Facturé</th>
                                        <th style={{ textAlign: 'right' }}>Dépenses</th>
                                        <th style={{ textAlign: 'right' }}>Marge Nette</th>
                                        <th style={{ width: 160 }}>Taux de marge</th>
                                        <th>Statut</th>
                                        <th style={{ textAlign: 'right' }}>Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rentabiliteClients.length === 0 ? (
                                        <tr>
                                            <td colSpan={9} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                                                Aucun client dans ce filtre de rentabilité.
                                            </td>
                                        </tr>
                                    ) : (
                                        rentabiliteClients.map((c, index) => {
                                            const cat = catMap[c.categorieId];
                                            const pct = Math.max(0, Math.min(100, c.pourcentageMarge || 0));

                                            let fillColor = 'var(--success)';
                                            let statutLabel = 'Très rentable';
                                            if (c.totalFacture === 0 && c.totalDepenses > 0) {
                                                fillColor = 'var(--danger)';
                                                statutLabel = 'Déficitaire';
                                            } else if (c.totalFacture === 0) {
                                                fillColor = 'var(--border)';
                                                statutLabel = 'Non facturé';
                                            } else if (c.pourcentageMarge < 0) {
                                                fillColor = 'var(--danger)';
                                                statutLabel = 'Déficitaire';
                                            } else if (c.pourcentageMarge < 40) {
                                                fillColor = '#d97706';
                                                statutLabel = 'Marge faible';
                                            } else if (c.pourcentageMarge < 70) {
                                                fillColor = 'var(--accent)';
                                                statutLabel = 'Rentable';
                                            }

                                            return (
                                                <tr
                                                    key={c.id}
                                                    style={{ cursor: 'pointer' }}
                                                    onClick={() => navigate(`/clients/${c.id}`)}
                                                >
                                                    <td style={{ fontWeight: 700, color: 'var(--text-muted)', fontSize: 12 }}>
                                                        #{index + 1}
                                                    </td>
                                                    <td>
                                                        <div style={{ fontWeight: 600 }}>{c.nom}</div>
                                                        {c.siteUrl && (
                                                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                                                {c.siteUrl.replace(/^https?:\/\//, '')}
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td>
                                                        {cat ? (
                                                            <span
                                                                className="badge"
                                                                style={{
                                                                    fontSize: 11,
                                                                    background: cat.couleur + '18',
                                                                    color: cat.couleur,
                                                                    border: `1px solid ${cat.couleur}44`,
                                                                }}
                                                            >
                                                                {cat.nom}
                                                            </span>
                                                        ) : (
                                                            <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>
                                                        )}
                                                    </td>
                                                    <td style={{ textAlign: 'right', fontWeight: 600 }}>
                                                        {formatMontant(c.totalFacture)}
                                                    </td>
                                                    <td style={{ textAlign: 'right', color: c.totalDepenses > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>
                                                        {c.totalDepenses > 0 ? `− ${formatMontant(c.totalDepenses)}` : '—'}
                                                    </td>
                                                    <td style={{ textAlign: 'right', fontWeight: 700, color: c.margeNette >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                                                        {formatMontant(c.margeNette)}
                                                    </td>
                                                    <td>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                            <div className="progress-bar" style={{ flex: 1 }}>
                                                                <div
                                                                    className="progress-fill"
                                                                    style={{
                                                                        width: `${pct}%`,
                                                                        background: fillColor,
                                                                    }}
                                                                />
                                                            </div>
                                                            <span style={{ fontSize: 11, fontWeight: 600, minWidth: 32, textAlign: 'right' }}>
                                                                {c.totalFacture > 0 ? `${c.pourcentageMarge}%` : '—'}
                                                            </span>
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <span
                                                            className="badge"
                                                            style={{
                                                                fontSize: 10,
                                                                background: fillColor + '18',
                                                                color: fillColor,
                                                                border: `1px solid ${fillColor}44`,
                                                            }}
                                                        >
                                                            {statutLabel}
                                                        </span>
                                                    </td>
                                                    <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                                                        <button
                                                            type="button"
                                                            className="btn btn--sm btn--ghost"
                                                            onClick={() => navigate(`/clients/${c.id}`)}
                                                        >
                                                            Fiche
                                                        </button>
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

            {/* ─── Modal Nouveau Client Complet ─── */}
            {showNewModal && (
                <div style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    zIndex: 1000, padding: 20,
                }}>
                    <div className="card" style={{ maxWidth: 560, width: '100%', padding: 24, maxHeight: '90vh', overflowY: 'auto', boxShadow: 'var(--shadow-md)' }}>
                        <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 4 }}>
                            Ajouter un nouveau client
                        </div>
                        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
                            Renseignez l'entreprise et les caractéristiques de son site internet.
                        </p>

                        <form onSubmit={creerClient}>
                            <div className="form-group">
                                <label className="form-label">Raison sociale / Entreprise *</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    placeholder="Ex. Château de Montmirail"
                                    value={newClient.nom}
                                    onChange={(e) => setNewClient((f) => ({ ...f, nom: e.target.value }))}
                                    required
                                    autoFocus
                                />
                            </div>

                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Prénom du contact</label>
                                    <input
                                        type="text"
                                        className="form-input"
                                        placeholder="Ex. Alexandre"
                                        value={newClient.contactPrenom}
                                        onChange={(e) => setNewClient((f) => ({ ...f, contactPrenom: e.target.value }))}
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Nom du contact</label>
                                    <input
                                        type="text"
                                        className="form-input"
                                        placeholder="Ex. Martin"
                                        value={newClient.contactNom}
                                        onChange={(e) => setNewClient((f) => ({ ...f, contactNom: e.target.value }))}
                                    />
                                </div>
                            </div>

                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Email</label>
                                    <input
                                        type="email"
                                        className="form-input"
                                        placeholder="alexandre@montmirail.fr"
                                        value={newClient.email}
                                        onChange={(e) => setNewClient((f) => ({ ...f, email: e.target.value }))}
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Téléphone</label>
                                    <input
                                        type="tel"
                                        className="form-input"
                                        placeholder="06 12 34 56 78"
                                        value={newClient.telephone}
                                        onChange={(e) => setNewClient((f) => ({ ...f, telephone: e.target.value }))}
                                    />
                                </div>
                            </div>

                            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, marginTop: 6, marginBottom: 14 }}>
                                <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', marginBottom: 12 }}>
                                    Site Internet & Hébergement
                                </div>

                                <div className="form-group">
                                    <label className="form-label">Adresse URL du site</label>
                                    <input
                                        type="text"
                                        className="form-input"
                                        placeholder="https://site-chateau.fr"
                                        value={newClient.siteUrl}
                                        onChange={(e) => setNewClient((f) => ({ ...f, siteUrl: e.target.value }))}
                                    />
                                </div>

                                <div className="form-row">
                                    <div className="form-group">
                                        <label className="form-label">Statut du site</label>
                                        <select
                                            className="form-select"
                                            value={newClient.siteStatut}
                                            onChange={(e) => setNewClient((f) => ({ ...f, siteStatut: e.target.value }))}
                                        >
                                            {SITE_STATUTS.map((s) => (
                                                <option key={s.id} value={s.id}>{s.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Catégorie</label>
                                        <select
                                            className="form-select"
                                            value={newClient.categorieId}
                                            onChange={(e) => setNewClient((f) => ({ ...f, categorieId: e.target.value }))}
                                        >
                                            <option value="">Non catégorisé</option>
                                            {categories.map((c) => (
                                                <option key={c.id} value={c.id}>{c.nom}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                <div className="form-row">
                                    <div className="form-group">
                                        <label className="form-label">Hébergeur / Registrar</label>
                                        <input
                                            type="text"
                                            className="form-input"
                                            placeholder="Ex. OVH, Infomaniak, Vercel"
                                            value={newClient.siteHebergeur}
                                            onChange={(e) => setNewClient((f) => ({ ...f, siteHebergeur: e.target.value }))}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Forfait maintenance (EUR/mois)</label>
                                        <input
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            className="form-input"
                                            placeholder="0.00"
                                            value={newClient.abonnementMensuelManuel}
                                            onChange={(e) => setNewClient((f) => ({ ...f, abonnementMensuelManuel: e.target.value }))}
                                        />
                                    </div>
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
                                <button
                                    type="button"
                                    className="btn btn--ghost"
                                    onClick={() => setShowNewModal(false)}
                                >
                                    Annuler
                                </button>
                                <button
                                    type="submit"
                                    className="btn btn--primary"
                                    disabled={saving || !newClient.nom.trim()}
                                >
                                    {saving ? 'Création...' : 'Créer la fiche client'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
