/**
 * App.jsx — Shell principal avec routing React Router v6
 * Sidebar fixe pliable et épinglable + zone de contenu principale
 */
import { BrowserRouter, Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import { useEffect, useState, useMemo } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { initDefaultData } from './services/initData';
import { NouvelleFacture } from './components/NouvelleFacture';
import { NouvelleDepense } from './components/NouvelleDepense';
import { FacturationClient } from './components/FacturationClient';
import { VersementPlateforme } from './components/VersementPlateforme';
import { NouveauDividende } from './components/NouveauDividende';
import { NouvelleAvanceFrais } from './components/NouvelleAvanceFrais';
import Overview from './pages/Overview';
import Reglages from './pages/Reglages';
import Login from './pages/Login';
import ListeFactures from './pages/ListeFactures';
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

// Configuration des sections de navigation
const SECTIONS_CONFIG = [
    {
        id: 'compta',
        title: 'Comptabilité',
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
        links: [
            { to: '/facturation/nouvelle', label: 'Facturation client' },
            { to: '/plateforme/nouveau', label: 'App Store / Play Store' },
        ],
    },
    {
        id: 'depenses',
        title: 'Dépenses',
        links: [
            { to: '/depenses/nouvelle', label: 'Nouvelle dépense' },
            { to: '/avances/nouvelle', label: 'Avance de frais' },
        ],
    },
    {
        id: 'clients',
        title: 'Clients',
        links: [
            { to: '/clients', label: 'Tous les clients' },
            { to: '/clients/categories', label: 'Catégories' },
        ],
    },
    {
        id: 'associes',
        title: 'Associés',
        links: [
            { to: '/associes', label: 'Membres' },
            { to: '/associes/cca', label: 'Comptes courants (CCA)' },
            { to: '/dividendes/nouveau', label: 'Nouveau dividende' },
        ],
    },
    {
        id: 'historique',
        title: 'Historique',
        links: [
            { to: '/factures', label: 'Factures manuelles' },
            { to: '/depenses', label: 'Dépenses' },
            { to: '/documents', label: '📁 Pièces justificatives' },
        ],
    },
    {
        id: 'systeme',
        title: 'Système',
        links: [
            { to: '/reglages', label: 'Réglages' },
        ],
    },
];

function Sidebar() {
    const location = useLocation();

    // Sections épinglées (persistées dans localStorage)
    const [pinned, setPinned] = useState(() => {
        try {
            const saved = localStorage.getItem('compta_sidebar_pinned');
            return saved ? JSON.parse(saved) : ['compta'];
        } catch {
            return ['compta'];
        }
    });

    // Sections repliées (persistées dans localStorage)
    const [collapsed, setCollapsed] = useState(() => {
        try {
            const saved = localStorage.getItem('compta_sidebar_collapsed');
            return saved ? JSON.parse(saved) : [];
        } catch {
            return [];
        }
    });

    function toggleCollapse(id) {
        setCollapsed((prev) => {
            const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
            try { localStorage.setItem('compta_sidebar_collapsed', JSON.stringify(next)); } catch { }
            return next;
        });
    }

    function togglePin(id) {
        setPinned((prev) => {
            const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
            try { localStorage.setItem('compta_sidebar_pinned', JSON.stringify(next)); } catch { }
            return next;
        });
    }

    // Trier les sections : les épinglées en premier
    const sortedSections = useMemo(() => {
        const pinnedList = SECTIONS_CONFIG.filter((s) => pinned.includes(s.id));
        const unpinnedList = SECTIONS_CONFIG.filter((s) => !pinned.includes(s.id));
        return [...pinnedList, ...unpinnedList];
    }, [pinned]);

    return (
        <aside className="sidebar">
            <div className="sidebar__logo">Compta<span>.</span></div>
            <nav className="sidebar__nav">

                {/* Navigation vers la Vue d'ensemble */}
                <NavLink to="/overview" end style={{ marginBottom: 12, fontWeight: 600 }}>
                    📊 Vue d'ensemble
                </NavLink>

                {sortedSections.map((sec, index) => {
                    const isPinned = pinned.includes(sec.id);
                    const hasActiveChild = sec.links.some((l) => location.pathname === l.to || location.pathname.startsWith(l.to + '/'));
                    const isCollapsed = collapsed.includes(sec.id) && !hasActiveChild;

                    // Afficher un séparateur / titre si on passe aux non-épinglés
                    const showUnpinnedHeader = !isPinned && index > 0 && pinned.includes(sortedSections[index - 1]?.id);

                    return (
                        <div key={sec.id} className="sidebar__section-group">
                            {showUnpinnedHeader && (
                                <div className="sidebar__group-label">Autres sections</div>
                            )}

                            <div
                                className="sidebar__section-header"
                                onClick={() => toggleCollapse(sec.id)}
                            >
                                <div className="sidebar__section-title">
                                    <span className="sidebar__arrow-icon" title={isCollapsed ? 'Déplier' : 'Replier'}>
                                        {isCollapsed ? (
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                <polyline points="9 18 15 12 9 6"></polyline>
                                            </svg>
                                        ) : (
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                <polyline points="6 9 12 15 18 9"></polyline>
                                            </svg>
                                        )}
                                    </span>
                                    <span>{sec.title}</span>
                                </div>

                                <button
                                    type="button"
                                    className={`sidebar__pin-btn ${isPinned ? 'sidebar__pin-btn--active' : ''}`}
                                    title={isPinned ? 'Désépingler cette section' : 'Épingler cette section en haut'}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        togglePin(sec.id);
                                    }}
                                >
                                    <span>📌</span>
                                    {isPinned ? <span className="sidebar__pin-label">Épinglé</span> : <span className="sidebar__pin-label" style={{ opacity: 0.6 }}>Pin</span>}
                                </button>
                            </div>

                            {!isCollapsed && (
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
        </aside>
    );
}

/* Wrapper page simple pour les composants formulaire */
function Page({ children }) {
    return <div>{children}</div>;
}

function AppLayout() {
    return (
        <div className="layout">
            <Sidebar />
            <main className="main">
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

                    {/* Associés */}
                    <Route path="/associes" element={<Associes />} />
                    <Route path="/associes/cca" element={<ComptesCourants />} />
                    <Route path="/associes/:associeId" element={<FicheAssocie />} />
                    <Route path="/dividendes/nouveau" element={<Page><NouveauDividende /></Page>} />

                    {/* Historique & Documents */}
                    <Route path="/factures/nouvelle" element={<NouvelleFacture />} />
                    <Route path="/factures" element={<ListeFactures />} />
                    <Route path="/documents" element={<Documents />} />

                    {/* Réglages */}
                    <Route path="/reglages" element={<Reglages />} />
                </Routes>
            </main>
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
