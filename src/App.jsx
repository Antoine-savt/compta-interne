/**
 * App.jsx — Shell principal avec routing React Router v6
 * Sidebar fixe pliable et épinglable + zone de contenu principale
 * Responsive mobile + Dark mode
 */
import { BrowserRouter, Routes, Route, NavLink, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState, useMemo } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { initDefaultData } from './services/initData';
import { NouvelleDepense } from './components/NouvelleDepense';
import { FacturationClient } from './components/FacturationClient';
import { VersementPlateforme } from './components/VersementPlateforme';
import { NouveauDividende } from './components/NouveauDividende';
import { NouvelleAvanceFrais } from './components/NouvelleAvanceFrais';
import Overview from './pages/Overview';
import Reglages from './pages/Reglages';
import Login from './pages/Login';
import ListeDepenses from './pages/ListeDepenses';
import Clients from './pages/Clients';
import FicheClient from './pages/FicheClient';
import CategoriesClient from './pages/CategoriesClient';
import Associes from './pages/Associes';
import FicheAssocie from './pages/FicheAssocie';
import ComptesCourants from './pages/ComptesCourants';
import Bilan from './pages/compta/Bilan';
import CompteResultat from './pages/compta/CompteResultat';
import GrandLivre from './pages/compta/GrandLivre';
import BalanceGenerale from './pages/compta/BalanceGenerale';
import Journaux from './pages/compta/Journaux';
import Documents from './pages/Documents';
import Agenda from './pages/Agenda';
import AgendaDisponibilites from './pages/AgendaDisponibilites';
import RdvNotificationMonitor from './components/agenda/RdvNotificationMonitor';

let initialized = false;
function InitData() {
    const { user } = useAuth();
    useEffect(() => {
        if (user && !initialized) {
            initialized = true;
            if (!sessionStorage.getItem('wheeloh_init_done')) {
                initDefaultData()
                    .then(() => sessionStorage.setItem('wheeloh_init_done', '1'))
                    .catch(console.error);
            }
        }
    }, [user]);
    return null;
}

function ProtectedRoute({ children }) {
    const { user } = useAuth();
    return user ? children : <Navigate to="/login" replace />;
}

// Configuration des sections de navigation avec icônes SVG épurées
const SECTIONS_CONFIG = [
    {
        id: 'compta',
        title: 'Comptabilité',
        icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
                <line x1="9" y1="7" x2="15" y2="7"></line>
                <line x1="9" y1="11" x2="15" y2="11"></line>
            </svg>
        ),
        links: [
            { to: '/compta/bilan', label: 'Bilan' },
            { to: '/compta/resultat', label: 'Compte de résultat' },
            { to: '/compta/grand-livre', label: 'Grand livre' },
            { to: '/compta/balance', label: 'Balance générale' },
            { to: '/compta/journaux', label: 'Journaux & FEC' },
        ],
    },
    {
        id: 'recettes',
        title: 'Recettes',
        icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
                <polyline points="17 6 23 6 23 12"></polyline>
            </svg>
        ),
        links: [
            { to: '/facturation/nouvelle', label: 'Facturation client' },
            { to: '/plateforme/nouveau', label: 'App Store / Play Store' },
        ],
    },
    {
        id: 'depenses',
        title: 'Dépenses',
        icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
                <line x1="1" y1="10" x2="23" y2="10"></line>
            </svg>
        ),
        links: [
            { to: '/depenses/nouvelle', label: 'Nouvelle dépense' },
            { to: '/avances/nouvelle', label: 'Avance de frais' },
        ],
    },
    {
        id: 'clients',
        title: 'Clients',
        icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
            </svg>
        ),
        links: [
            { to: '/clients', label: 'Tous les clients' },
            { to: '/clients/categories', label: 'Catégories' },
        ],
    },
    {
        id: 'agenda',
        title: 'Agenda & RDV',
        icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="16" y1="2" x2="16" y2="6"></line>
                <line x1="8" y1="2" x2="8" y2="6"></line>
                <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
        ),
        links: [
            { to: '/agenda', label: 'Calendrier des RDV' },
            { to: '/agenda/disponibilites', label: 'Mes disponibilités' },
        ],
    },
    {
        id: 'associes',
        title: 'Associés',
        icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="5"></circle>
                <path d="M20 21a8 8 0 1 0-16 0"></path>
            </svg>
        ),
        links: [
            { to: '/associes', label: 'Membres' },
            { to: '/associes/cca', label: 'Comptes courants (CCA)' },
            { to: '/dividendes/nouveau', label: 'Nouveau dividende' },
        ],
    },
    {
        id: 'historique',
        title: 'Historique',
        icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
        ),
        links: [
            { to: '/depenses', label: 'Dépenses' },
            { to: '/documents', label: 'Pièces justificatives' },
        ],
    },
    {
        id: 'systeme',
        title: 'Système',
        icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
        ),
        links: [
            { to: '/reglages', label: 'Réglages' },
        ],
    },
];

function Sidebar({ isCollapsed, onToggleCollapse, isMobileOpen, onCloseMobile, theme, onToggleTheme }) {
    const location = useLocation();
    const navigate = useNavigate();

    // Accordéons de sections repliées (persistées dans localStorage)
    const [collapsedSections, setCollapsedSections] = useState(() => {
        try {
            const saved = localStorage.getItem('compta_sidebar_sections_collapsed');
            return saved ? JSON.parse(saved) : [];
        } catch {
            return [];
        }
    });

    function toggleSection(id) {
        setCollapsedSections((prev) => {
            const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
            try { localStorage.setItem('compta_sidebar_sections_collapsed', JSON.stringify(next)); } catch { }
            return next;
        });
    }

    return (
        <aside className={`sidebar ${isCollapsed ? 'sidebar--collapsed' : ''} ${isMobileOpen ? 'sidebar--mobile-open' : ''}`}>
            {/* Header avec logo et bouton toggle */}
            <div className="sidebar__header">
                {!isCollapsed ? (
                    <div className="sidebar__logo">Compta<span>.</span></div>
                ) : (
                    <div className="sidebar__logo" style={{ fontSize: 18 }}>C<span>.</span></div>
                )}
                <button
                    type="button"
                    className="sidebar__toggle-btn"
                    onClick={onToggleCollapse}
                    title={isCollapsed ? 'Agrandir la barre latérale' : 'Réduire la barre latérale'}
                    aria-label="Réduire ou agrandir la barre latérale"
                >
                    {isCollapsed ? (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="13 17 18 12 13 7"></polyline>
                            <polyline points="6 17 11 12 6 7"></polyline>
                        </svg>
                    ) : (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="11 17 6 12 11 7"></polyline>
                            <polyline points="18 17 13 12 18 7"></polyline>
                        </svg>
                    )}
                </button>
            </div>

            {/* Navigation principale */}
            <nav className="sidebar__nav">
                {/* Vue d'ensemble */}
                <NavLink
                    to="/overview"
                    end
                    className={({ isActive }) => isActive ? 'active' : ''}
                    title="Vue d'ensemble"
                    style={{ marginBottom: 8 }}
                >
                    <span className="sidebar__section-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="3" width="7" height="7"></rect>
                            <rect x="14" y="3" width="7" height="7"></rect>
                            <rect x="14" y="14" width="7" height="7"></rect>
                            <rect x="3" y="14" width="7" height="7"></rect>
                        </svg>
                    </span>
                    {!isCollapsed && <span style={{ fontWeight: 600 }}>Vue d'ensemble</span>}
                </NavLink>

                {/* Sections */}
                {SECTIONS_CONFIG.map((sec) => {
                    const hasActiveChild = sec.links.some((l) => location.pathname === l.to || location.pathname.startsWith(l.to + '/'));
                    const isSectionCollapsed = collapsedSections.includes(sec.id) && !hasActiveChild;

                    if (isCollapsed) {
                        return (
                            <div key={sec.id} className="sidebar__section-group">
                                <div
                                    className={`sidebar__section-header ${hasActiveChild ? 'is-active' : ''}`}
                                    title={sec.title}
                                    onClick={() => navigate(sec.links[0].to)}
                                    style={{
                                        background: hasActiveChild ? (theme === 'dark' ? 'rgba(56, 189, 248, 0.16)' : 'rgba(37, 99, 235, 0.12)') : 'transparent',
                                        color: hasActiveChild ? 'var(--accent)' : 'inherit'
                                    }}
                                >
                                    <span className="sidebar__section-icon" style={{ color: hasActiveChild ? 'var(--accent)' : 'inherit' }}>
                                        {sec.icon}
                                    </span>
                                </div>
                            </div>
                        );
                    }

                    return (
                        <div key={sec.id} className={`sidebar__section-group ${hasActiveChild ? 'is-active' : ''}`}>
                            <div
                                className="sidebar__section-header"
                                onClick={() => toggleSection(sec.id)}
                            >
                                <div className="sidebar__section-title">
                                    <span className="sidebar__section-icon">
                                        {sec.icon}
                                    </span>
                                    <span>{sec.title}</span>
                                </div>
                                <span className="sidebar__arrow-icon" title={isSectionCollapsed ? 'Déplier' : 'Replier'}>
                                    {isSectionCollapsed ? (
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                            <polyline points="9 18 15 12 9 6"></polyline>
                                        </svg>
                                    ) : (
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                            <polyline points="6 9 12 15 18 9"></polyline>
                                        </svg>
                                    )}
                                </span>
                            </div>

                            {!isSectionCollapsed && (
                                <div className="sidebar__section-content">
                                    {sec.links.map((link) => (
                                        <NavLink key={link.to} to={link.to}>
                                            {link.label}
                                        </NavLink>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </nav>

            {/* Footer de la sidebar : Thème Sombre / Clair */}
            <div className="sidebar__footer">
                <button
                    type="button"
                    className="sidebar__theme-btn"
                    onClick={onToggleTheme}
                    title={theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre'}
                >
                    {theme === 'dark' ? (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="5"></circle>
                            <line x1="12" y1="1" x2="12" y2="3"></line>
                            <line x1="12" y1="21" x2="12" y2="23"></line>
                            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                            <line x1="1" y1="12" x2="3" y2="12"></line>
                            <line x1="21" y1="12" x2="23" y2="12"></line>
                            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
                        </svg>
                    ) : (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
                        </svg>
                    )}
                    {!isCollapsed && <span>{theme === 'dark' ? 'Mode clair' : 'Mode sombre'}</span>}
                </button>
            </div>
        </aside>
    );
}

/* Wrapper page simple pour les composants formulaire */
function Page({ children }) {
    return <div>{children}</div>;
}

function AppLayout() {
    const location = useLocation();

    // Dark mode state
    const [theme, setTheme] = useState(() => {
        try {
            return localStorage.getItem('wheeloh_theme') || 'light';
        } catch {
            return 'light';
        }
    });

    // Sidebar collapsed state
    const [isCollapsed, setIsCollapsed] = useState(() => {
        try {
            return localStorage.getItem('wheeloh_sidebar_collapsed') === 'true';
        } catch {
            return false;
        }
    });

    // Mobile drawer state
    const [isMobileOpen, setIsMobileOpen] = useState(false);

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        try {
            localStorage.setItem('wheeloh_theme', theme);
        } catch { }
    }, [theme]);

    useEffect(() => {
        try {
            localStorage.setItem('wheeloh_sidebar_collapsed', isCollapsed ? 'true' : 'false');
        } catch { }
    }, [isCollapsed]);

    // Fermer le menu mobile lors du changement de route
    useEffect(() => {
        setIsMobileOpen(false);
    }, [location.pathname]);

    function toggleTheme() {
        setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
    }

    function toggleSidebar() {
        setIsCollapsed((prev) => !prev);
    }

    return (
        <div className="layout">
            {/* Topbar visible uniquement sur petits écrans */}
            <div className="mobile-topbar">
                <button
                    type="button"
                    className="sidebar__toggle-btn"
                    onClick={() => setIsMobileOpen(true)}
                    aria-label="Ouvrir le menu"
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="3" y1="12" x2="21" y2="12"></line>
                        <line x1="3" y1="6" x2="21" y2="6"></line>
                        <line x1="3" y1="18" x2="21" y2="18"></line>
                    </svg>
                </button>
                <div className="sidebar__logo">Compta<span>.</span></div>
                <button
                    type="button"
                    className="sidebar__toggle-btn"
                    onClick={toggleTheme}
                    title={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
                >
                    {theme === 'dark' ? (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="5"></circle>
                            <line x1="12" y1="1" x2="12" y2="3"></line>
                            <line x1="12" y1="21" x2="12" y2="23"></line>
                            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                            <line x1="1" y1="12" x2="3" y2="12"></line>
                            <line x1="21" y1="12" x2="23" y2="12"></line>
                            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
                        </svg>
                    ) : (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
                        </svg>
                    )}
                </button>
            </div>

            {/* Backdrop pour fermer le menu mobile en cliquant en dehors */}
            <div
                className={`sidebar-backdrop ${isMobileOpen ? 'active' : ''}`}
                onClick={() => setIsMobileOpen(false)}
            />

            {/* Sidebar principale */}
            <Sidebar
                isCollapsed={isCollapsed}
                onToggleCollapse={toggleSidebar}
                isMobileOpen={isMobileOpen}
                onCloseMobile={() => setIsMobileOpen(false)}
                theme={theme}
                onToggleTheme={toggleTheme}
            />

            {/* Contenu principal */}
            <main className={`main ${isCollapsed ? 'main--collapsed' : ''}`}>
                <Routes>
                    <Route path="/" element={<Navigate to="/overview" replace />} />
                    <Route path="/overview" element={<Overview />} />

                    {/* Comptabilité légale */}
                    <Route path="/compta/bilan" element={<Bilan />} />
                    <Route path="/compta/resultat" element={<CompteResultat />} />
                    <Route path="/compta/grand-livre" element={<GrandLivre />} />
                    <Route path="/compta/balance" element={<BalanceGenerale />} />
                    <Route path="/compta/journaux" element={<Journaux />} />

                    {/* Recettes */}
                    <Route path="/facturation/nouvelle" element={<FacturationClient />} />
                    <Route path="/plateforme/nouveau" element={<VersementPlateforme />} />

                    {/* Dépenses */}
                    <Route path="/depenses/nouvelle" element={<NouvelleDepense />} />
                    <Route path="/depenses" element={<ListeDepenses />} />

                    {/* Avances de frais */}
                    <Route path="/avances/nouvelle" element={<Page><NouvelleAvanceFrais /></Page>} />

                    {/* Clients */}
                    <Route path="/clients" element={<Clients />} />
                    <Route path="/clients/categories" element={<CategoriesClient />} />
                    <Route path="/clients/:clientId" element={<FicheClient />} />

                    {/* Agenda & Rendez-vous */}
                    <Route path="/agenda" element={<Agenda />} />
                    <Route path="/agenda/disponibilites" element={<AgendaDisponibilites />} />

                    {/* Associés */}
                    <Route path="/associes" element={<Associes />} />
                    <Route path="/associes/cca" element={<ComptesCourants />} />
                    <Route path="/associes/:associeId" element={<FicheAssocie />} />
                    <Route path="/dividendes/nouveau" element={<Page><NouveauDividende /></Page>} />

                    {/* Historique & Documents */}
                    <Route path="/factures/*" element={<Navigate to="/facturation/nouvelle" replace />} />
                    <Route path="/factures" element={<Navigate to="/facturation/nouvelle" replace />} />
                    <Route path="/documents" element={<Documents />} />

                    {/* Réglages */}
                    <Route path="/reglages" element={<Reglages />} />
                </Routes>
            </main>

            {/* Moniteur de notifications en temps réel pour les RDV */}
            <RdvNotificationMonitor />
        </div>
    );
}

export default function App() {
    return (
        <AuthProvider>
            <BrowserRouter>
                <InitData />
                <Routes>
                    <Route path="/login" element={<Login />} />
                    <Route path="/*" element={
                        <ProtectedRoute>
                            <AppLayout />
                        </ProtectedRoute>
                    } />
                </Routes>
            </BrowserRouter>
        </AuthProvider>
    );
}
