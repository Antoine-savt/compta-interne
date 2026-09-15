/**
 * Agenda.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Page principale de Gestion des Rendez-vous & Calendrier
 * - Vues interchangeables : Mois, Semaine, Jour, Liste récapitulative
 * - Filtrage par personne (Tous, Antoine, Théophile, ou Mes rendez-vous)
 * - Filtrage par type (Visio, Appel, Présentiel)
 * - Détection et synthèse immédiate des conflits horaires
 * - Synchronisation en temps réel avec les fiches clients
 * 
 * Contrainte stricte : AUCUN EMOJI. Design sobre, dense et épuré.
 */
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { getRendezVousList, createRendezVous, calculateEndTime } from '../services/rdvService';
import { getUnifiedGestionnaires } from '../services/crmGestionnairesService';
import { getCached, setCached } from '../services/dataCache';
import { doIntervalsOverlap } from '../services/rdvAvailabilityService';
import { toISODate } from '../services/helpers';
import AgendaMonthView from '../components/agenda/AgendaMonthView';
import AgendaWeekView from '../components/agenda/AgendaWeekView';
import AgendaDayView from '../components/agenda/AgendaDayView';
import AgendaListView from '../components/agenda/AgendaListView';
import ModalCreateRdv from '../components/agenda/ModalCreateRdv';

export default function Agenda() {
    const navigate = useNavigate();

    // Données principales
    const [rdvs, setRdvs] = useState([]);
    const [clients, setClients] = useState(() => getCached('clients') || []);
    const [gestionnaires, setGestionnaires] = useState(() => getCached('crm_gestionnaires') || ['Antoine', 'Thomas']);
    const [loading, setLoading] = useState(true);

    // État de la vue courante ('mois' | 'semaine' | 'jour' | 'liste')
    const [currentView, setCurrentView] = useState(() => {
        return localStorage.getItem('crm_agenda_view') || 'semaine';
    });

    // Date actuellement observée
    const [currentDate, setCurrentDate] = useState(() => new Date());

    // Filtres
    const [personFilter, setPersonFilter] = useState('tous'); // 'tous' | 'Antoine' | 'Thomas' ...
    const [typeFilter, setTypeFilter] = useState('tous'); // 'tous' | 'visio' | 'telephone' | 'presentiel'
    const [search, setSearch] = useState('');

    // Modale de création / édition
    const [showModal, setShowModal] = useState(false);
    const [editingRdv, setEditingRdv] = useState(null);
    const [preselectedDate, setPreselectedDate] = useState('');
    const [preselectedTime, setPreselectedTime] = useState('');

    // Sauvegarder la préférence de vue
    function changeView(view) {
        setCurrentView(view);
        try { localStorage.setItem('crm_agenda_view', view); } catch {}
    }

    // Chargement initial des données & réconciliation complète
    async function loadData() {
        setLoading(true);
        try {
            const [rdvList, gests, clientsSnap] = await Promise.all([
                getRendezVousList(),
                getUnifiedGestionnaires(),
                getDocs(collection(db, 'clients')).catch(() => ({ docs: [] })),
            ]);

            // Mettre à jour les gestionnaires
            if (gests && gests.length > 0) setGestionnaires(gests);

            // Charger les clients réels depuis Firestore
            let loadedClients = [];
            if (clientsSnap && clientsSnap.docs && clientsSnap.docs.length > 0) {
                loadedClients = clientsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
                setClients(loadedClients);
                setCached('clients', loadedClients);
            } else {
                loadedClients = getCached('clients') || [];
            }

            // Réconciliation avec les RDV enregistrés directement sur les fiches clients
            let combinedRdvs = Array.isArray(rdvList) ? [...rdvList] : [];
            const rdvKeySet = new Set(
                combinedRdvs.map((r) => `${r.clientId || r.clientNom}_${r.date}_${r.heureDebut || ''}`)
            );
            const missingToSync = [];

            loadedClients.forEach((c) => {
                if (c.prochainRdvDate) {
                    const key1 = `${c.id}_${c.prochainRdvDate}_${c.prochainRdvHeure || ''}`;
                    const key2 = `${c.nom}_${c.prochainRdvDate}_${c.prochainRdvHeure || ''}`;
                    // Vérifier aussi si un rdv existe pour ce client à cette date même sans heure exacte
                    const alreadyPresent = combinedRdvs.some(
                        (r) => (r.clientId === c.id || r.clientNom === c.nom) && r.date === c.prochainRdvDate
                    );

                    if (!rdvKeySet.has(key1) && !rdvKeySet.has(key2) && !alreadyPresent) {
                        const contactName = `${c.contactPrenom || ''} ${c.contactNom || ''}`.trim() || c.contact || '';
                        const hDeb = c.prochainRdvHeure || '14:00';
                        const synched = {
                            id: `client_rdv_${c.id}`,
                            clientId: c.id,
                            clientNom: c.nom || 'Client sans nom',
                            clientContact: contactName,
                            clientTelephone: c.telephone || '',
                            clientEmail: c.email || '',
                            quiGere: c.quiGere || (gests && gests[0]) || 'Antoine',
                            date: c.prochainRdvDate,
                            heureDebut: hDeb,
                            heureFin: calculateEndTime(hDeb, 30),
                            dureeMinutes: 30,
                            type: c.prochainRdvFormat || 'visio',
                            notes: c.prochainRdvObjet || 'Point client',
                            lienVisio: c.prochainRdvLien || '',
                            statut: 'planifie',
                            syncedFromClient: true,
                        };
                        combinedRdvs.push(synched);
                        rdvKeySet.add(key1);
                        missingToSync.push(synched);
                    }
                }
            });

            setRdvs(combinedRdvs);

            // Persister en tâche de fond dans Firestore pour les prochaines lectures
            if (missingToSync.length > 0) {
                missingToSync.forEach((r) => {
                    createRendezVous(r).catch((err) => console.warn('Erreur synchro rdv fond:', err));
                });
            }
        } catch (err) {
            console.error('Erreur chargement Agenda:', err);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadData();
    }, []);

    // Navigation temporelle (Précédent / Suivant / Aujourd'hui)
    function handlePrev() {
        const d = new Date(currentDate);
        if (currentView === 'mois') {
            d.setMonth(d.getMonth() - 1);
        } else if (currentView === 'semaine') {
            d.setDate(d.getDate() - 7);
        } else {
            d.setDate(d.getDate() - 1);
        }
        setCurrentDate(d);
    }

    function handleNext() {
        const d = new Date(currentDate);
        if (currentView === 'mois') {
            d.setMonth(d.getMonth() + 1);
        } else if (currentView === 'semaine') {
            d.setDate(d.getDate() + 7);
        } else {
            d.setDate(d.getDate() + 1);
        }
        setCurrentDate(d);
    }

    function handleToday() {
        setCurrentDate(new Date());
    }

    // Titre dynamique de la période affichée
    const periodTitle = useMemo(() => {
        if (currentView === 'mois') {
            return currentDate.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
        }
        if (currentView === 'jour') {
            return currentDate.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        }
        if (currentView === 'semaine') {
            const d = new Date(currentDate);
            const day = d.getDay();
            const diffToMonday = day === 0 ? -6 : 1 - day;
            const monday = new Date(d);
            monday.setDate(d.getDate() + diffToMonday);
            const sunday = new Date(monday);
            sunday.setDate(monday.getDate() + 6);

            const mStr = monday.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
            const sStr = sunday.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
            return `Semaine du ${mStr} au ${sStr}`;
        }
        return 'Tous les rendez-vous';
    }, [currentDate, currentView]);

    // RDVs filtrés
    const filteredRdvs = useMemo(() => {
        return rdvs.filter((r) => {
            if (personFilter !== 'tous') {
                if ((r.quiGere || '').toLowerCase() !== personFilter.toLowerCase()) return false;
            }
            if (typeFilter !== 'tous' && r.type !== typeFilter) return false;
            if (search.trim()) {
                const q = search.trim().toLowerCase();
                const matchNom = (r.clientNom || '').toLowerCase().includes(q);
                const matchContact = (r.clientContact || '').toLowerCase().includes(q);
                const matchNotes = (r.notes || '').toLowerCase().includes(q);
                if (!matchNom && !matchContact && !matchNotes) return false;
            }
            return true;
        });
    }, [rdvs, personFilter, typeFilter, search]);

    // Statistiques rapides & détection des conflits
    const stats = useMemo(() => {
        const todayStr = toISODate(new Date());
        let todayCount = 0;
        let upcomingCount = 0;
        let conflictsCount = 0;

        // Détection de tous les conflits
        const activeRdvs = rdvs.filter((r) => r.statut !== 'annule');
        for (let i = 0; i < activeRdvs.length; i++) {
            for (let j = i + 1; j < activeRdvs.length; j++) {
                const r1 = activeRdvs[i];
                const r2 = activeRdvs[j];
                if (
                    r1.date === r2.date &&
                    r1.quiGere === r2.quiGere &&
                    doIntervalsOverlap(r1.heureDebut, r1.heureFin, r2.heureDebut, r2.heureFin)
                ) {
                    conflictsCount++;
                }
            }
        }

        rdvs.forEach((r) => {
            if (r.statut === 'planifie') {
                if (r.date === todayStr) todayCount++;
                if (r.date >= todayStr) upcomingCount++;
            }
        });

        return {
            today: todayCount,
            upcoming: upcomingCount,
            conflicts: conflictsCount,
            total: rdvs.length,
        };
    }, [rdvs]);

    // Gestionnaires uniques déduits
    const effectiveGestionnaires = useMemo(() => {
        const set = new Set([...gestionnaires]);
        rdvs.forEach((r) => {
            if (r.quiGere) set.add(r.quiGere);
        });
        return Array.from(set);
    }, [gestionnaires, rdvs]);

    // Dictionnaire des clients indexé par id pour un accès O(1)
    const clientsMap = useMemo(() => {
        return Object.fromEntries((clients || []).map((c) => [c.id, c]));
    }, [clients]);

    // Fonctions d'ouverture de modale
    function handleOpenNewRdv(preDate = '', preTime = '') {
        setEditingRdv(null);
        setPreselectedDate(preDate || toISODate(currentDate));
        setPreselectedTime(preTime || '09:30');
        setShowModal(true);
    }

    function handleEditRdv(rdv) {
        setEditingRdv(rdv);
        setShowModal(true);
    }

    function handleRdvSaved(savedRdv) {
        setRdvs((prev) => {
            const idx = prev.findIndex((r) => r.id === savedRdv.id);
            if (idx !== -1) {
                return prev.map((r) => (r.id === savedRdv.id ? savedRdv : r));
            }
            return [...prev, savedRdv];
        });
    }

    function handleRdvDeleted(rdvId) {
        setRdvs((prev) => prev.filter((r) => r.id !== rdvId));
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%' }}>
            {/* ─── Barre de Titre Supérieure & Actions ─────────────────────────── */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: 'var(--text)' }}>
                        Agenda & Rendez-vous
                    </h1>
                    <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
                        Planning des appels, visioconférences et disponibilités de l'équipe
                    </div>
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button
                        type="button"
                        onClick={() => navigate('/agenda/disponibilites')}
                        className="btn btn--secondary btn--sm"
                        style={{ fontSize: 12 }}
                    >
                        Gérer mes disponibilités
                    </button>
                    <button
                        type="button"
                        onClick={() => handleOpenNewRdv()}
                        className="btn btn--primary btn--sm"
                        style={{ fontSize: 12, fontWeight: 700 }}
                    >
                        + Nouveau RDV
                    </button>
                </div>
            </div>

            {/* ─── Bandeau de synthèse & Alertes Conflits ─────────────────────── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                <div className="card" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                            Aujourd'hui
                        </div>
                        <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--accent)', marginTop: 2 }}>
                            {stats.today}
                        </div>
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>RDV planifiés</span>
                </div>

                <div className="card" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                            À venir
                        </div>
                        <div style={{ fontSize: 20, fontWeight: 800, color: '#10b981', marginTop: 2 }}>
                            {stats.upcoming}
                        </div>
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>RDV futurs</span>
                </div>

                <div
                    className="card"
                    style={{
                        padding: '10px 14px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        border: stats.conflicts > 0 ? '1.5px solid #ef4444' : '1px solid var(--border)',
                        background: stats.conflicts > 0 ? 'rgba(239, 68, 68, 0.06)' : undefined,
                    }}
                >
                    <div>
                        <div style={{ fontSize: 11, color: stats.conflicts > 0 ? '#ef4444' : 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                            Conflits détectés
                        </div>
                        <div style={{ fontSize: 20, fontWeight: 800, color: stats.conflicts > 0 ? '#ef4444' : 'var(--text)', marginTop: 2 }}>
                            {stats.conflicts}
                        </div>
                    </div>
                    <span style={{ fontSize: 11, color: stats.conflicts > 0 ? '#ef4444' : 'var(--text-muted)', fontWeight: stats.conflicts > 0 ? 700 : 400 }}>
                        {stats.conflicts > 0 ? 'Attention, chevauchements !' : 'Aucun doublon'}
                    </span>
                </div>
            </div>

            {/* ─── Barre de Contrôle du Calendrier (Vues + Navigation + Filtres) ─ */}
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 12,
                    padding: '10px 14px',
                    background: 'var(--bg3)',
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                }}
            >
                {/* Navigation temporelle */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button
                        type="button"
                        onClick={handlePrev}
                        className="btn btn--secondary btn--sm"
                        style={{ padding: '3px 8px' }}
                        title="Précédent"
                    >
                        ‹
                    </button>
                    <button
                        type="button"
                        onClick={handleToday}
                        className="btn btn--ghost btn--sm"
                        style={{ fontSize: 12, padding: '3px 10px', fontWeight: 600 }}
                    >
                        Aujourd'hui
                    </button>
                    <button
                        type="button"
                        onClick={handleNext}
                        className="btn btn--secondary btn--sm"
                        style={{ padding: '3px 8px' }}
                        title="Suivant"
                    >
                        ›
                    </button>

                    <span style={{ fontSize: 15, fontWeight: 700, marginLeft: 8, textTransform: 'capitalize', color: 'var(--text)' }}>
                        {periodTitle}
                    </span>
                </div>

                {/* Sélecteur de vues (Mois / Semaine / Jour / Liste) */}
                <div style={{ display: 'flex', gap: 2, background: 'var(--bg)', padding: 3, borderRadius: 6, border: '1px solid var(--border)' }}>
                    <button
                        type="button"
                        onClick={() => changeView('mois')}
                        className={`btn btn--sm ${currentView === 'mois' ? 'btn--primary' : 'btn--ghost'}`}
                        style={{ padding: '3px 10px', fontSize: 11, fontWeight: 600, borderRadius: 4 }}
                    >
                        Mois
                    </button>
                    <button
                        type="button"
                        onClick={() => changeView('semaine')}
                        className={`btn btn--sm ${currentView === 'semaine' ? 'btn--primary' : 'btn--ghost'}`}
                        style={{ padding: '3px 10px', fontSize: 11, fontWeight: 600, borderRadius: 4 }}
                    >
                        Semaine
                    </button>
                    <button
                        type="button"
                        onClick={() => changeView('jour')}
                        className={`btn btn--sm ${currentView === 'jour' ? 'btn--primary' : 'btn--ghost'}`}
                        style={{ padding: '3px 10px', fontSize: 11, fontWeight: 600, borderRadius: 4 }}
                    >
                        Jour
                    </button>
                    <button
                        type="button"
                        onClick={() => changeView('liste')}
                        className={`btn btn--sm ${currentView === 'liste' ? 'btn--primary' : 'btn--ghost'}`}
                        style={{ padding: '3px 10px', fontSize: 11, fontWeight: 600, borderRadius: 4 }}
                    >
                        Liste
                    </button>
                </div>

                {/* Filtres de gestionnaire et de format */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {/* Filtre personne */}
                    <select
                        value={personFilter}
                        onChange={(e) => setPersonFilter(e.target.value)}
                        className="form-control"
                        style={{ height: 30, fontSize: 11, width: 140 }}
                    >
                        <option value="tous">Tous les gestionnaires</option>
                        {effectiveGestionnaires.map((g) => (
                            <option key={g} value={g}>{g}</option>
                        ))}
                    </select>

                    {/* Filtre type */}
                    <select
                        value={typeFilter}
                        onChange={(e) => setTypeFilter(e.target.value)}
                        className="form-control"
                        style={{ height: 30, fontSize: 11, width: 130 }}
                    >
                        <option value="tous">Tous formats</option>
                        <option value="visio">Visioconférence</option>
                        <option value="telephone">Appel téléphonique</option>
                        <option value="presentiel">Présentiel</option>
                    </select>
                </div>
            </div>

            {/* ─── Rendu de la Vue Calendrier Active ──────────────────────────── */}
            {loading ? (
                <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                    Chargement du planning des rendez-vous...
                </div>
            ) : currentView === 'mois' ? (
                <AgendaMonthView
                    currentDate={currentDate}
                    rdvs={filteredRdvs}
                    clients={clients}
                    clientsMap={clientsMap}
                    onSelectDate={(dateStr) => {
                        setCurrentDate(new Date(dateStr + 'T00:00:00'));
                        changeView('jour');
                    }}
                    onSelectRdv={handleEditRdv}
                    onAddRdvAtDate={(dateStr) => handleOpenNewRdv(dateStr, '09:30')}
                />
            ) : currentView === 'semaine' ? (
                <AgendaWeekView
                    currentDate={currentDate}
                    rdvs={filteredRdvs}
                    clients={clients}
                    clientsMap={clientsMap}
                    onSelectRdv={handleEditRdv}
                    onAddRdvAtDateAndTime={(dateStr, timeStr) => handleOpenNewRdv(dateStr, timeStr)}
                />
            ) : currentView === 'jour' ? (
                <AgendaDayView
                    selectedDate={toISODate(currentDate)}
                    rdvs={filteredRdvs}
                    clients={clients}
                    clientsMap={clientsMap}
                    onSelectRdv={handleEditRdv}
                    onAddRdvAtDateAndTime={(dateStr, timeStr) => handleOpenNewRdv(dateStr, timeStr)}
                />
            ) : (
                <AgendaListView
                    rdvs={filteredRdvs}
                    clients={clients}
                    clientsMap={clientsMap}
                    onSelectRdv={handleEditRdv}
                    onAddRdv={() => handleOpenNewRdv()}
                />
            )}

            {/* ─── Modale de Création / Modification de RDV ───────────────────── */}
            {showModal && (
                <ModalCreateRdv
                    initialRdv={editingRdv}
                    preselectedDate={preselectedDate}
                    preselectedTime={preselectedTime}
                    preselectedPerson={personFilter !== 'tous' ? personFilter : ''}
                    clients={clients}
                    gestionnaires={effectiveGestionnaires}
                    allRdvs={rdvs}
                    onClose={() => setShowModal(false)}
                    onSaved={handleRdvSaved}
                    onDeleted={handleRdvDeleted}
                />
            )}
        </div>
    );
}
