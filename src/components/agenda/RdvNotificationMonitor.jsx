/**
 * RdvNotificationMonitor.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Moniteur d'arrière-plan pour les rappels de rendez-vous en temps réel :
 * - Scrute les RDV à venir selon le délai configuré (ex: 15 min avant)
 * - Joue un signal sonore discret (Web Audio synthétiseur)
 * - Déclenche une notification de bureau native
 * - Affiche une bannière / toast In-App élégante avec actions rapides
 */
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getRendezVousList } from '../../services/rdvService';
import {
    checkDueReminders,
    playChimeSound,
    showDesktopNotification,
    requestDesktopNotificationPermission,
} from '../../services/rdvNotificationService';

export default function RdvNotificationMonitor() {
    const navigate = useNavigate();
    const [activeAlerts, setActiveAlerts] = useState([]);
    const permissionRequestedRef = useRef(false);

    // Demander la permission notification de bureau au premier montage
    useEffect(() => {
        if (!permissionRequestedRef.current) {
            permissionRequestedRef.current = true;
            requestDesktopNotificationPermission().catch(() => {});
        }
    }, []);

    // Vérification périodique toutes les 20 secondes
    useEffect(() => {
        let isMounted = true;

        async function verify() {
            try {
                const rdvs = await getRendezVousList();
                if (!isMounted || !Array.isArray(rdvs)) return;

                const dueList = checkDueReminders(rdvs);

                if (dueList.length > 0) {
                    dueList.forEach(({ rdv, minutesLeft }) => {
                        sessionStorage.setItem(`rdv_notified_${rdv.id}`, '1');

                        // 1. Son d'alerte discret
                        playChimeSound();

                        // 2. Notification de bureau native
                        showDesktopNotification(
                            `Rappel RDV dans ${minutesLeft} min : ${rdv.clientNom}`,
                            {
                                body: `${rdv.heureDebut} - ${rdv.heureFin} • ${rdv.type} avec ${rdv.quiGere}`,
                            }
                        );
                    });

                    // 3. Ajouter à la liste des bannières in-app
                    setActiveAlerts((prev) => {
                        const newIds = new Set(dueList.map((d) => d.rdv.id));
                        const filtered = prev.filter((a) => !newIds.has(a.rdv.id));
                        return [...filtered, ...dueList];
                    });
                }
            } catch (err) {
                // Erreur silencieuse
            }
        }

        verify();
        const interval = setInterval(verify, 20000); // 20s
        return () => {
            isMounted = false;
            clearInterval(interval);
        };
    }, []);

    function dismissAlert(rdvId) {
        setActiveAlerts((prev) => prev.filter((a) => a.rdv.id !== rdvId));
    }

    if (activeAlerts.length === 0) return null;

    return (
        <div
            style={{
                position: 'fixed',
                top: 16,
                right: 16,
                zIndex: 999999,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                maxWidth: 380,
                width: 'calc(100% - 32px)',
                pointerEvents: 'none',
            }}
        >
            {activeAlerts.map(({ rdv, minutesLeft }) => {
                const isVisio = rdv.type === 'visio';

                return (
                    <div
                        key={rdv.id}
                        style={{
                            pointerEvents: 'auto',
                            background: '#0f172a',
                            color: '#ffffff',
                            borderRadius: 10,
                            padding: '12px 14px',
                            boxShadow: '0 10px 30px rgba(0, 0, 0, 0.4)',
                            border: '1.5px solid var(--accent)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 8,
                            animation: 'slide-in-alert 0.3s ease-out',
                        }}
                    >
                        {/* Ligne d'en-tête */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span
                                    style={{
                                        background: 'var(--accent)',
                                        color: '#0f172a',
                                        fontSize: 10,
                                        fontWeight: 800,
                                        padding: '2px 6px',
                                        borderRadius: 4,
                                        textTransform: 'uppercase',
                                    }}
                                >
                                    Rappel RDV
                                </span>
                                <span style={{ fontSize: 12, fontWeight: 700, color: '#38bdf8' }}>
                                    {minutesLeft === 0 ? 'Commence maintenant !' : `Dans ${minutesLeft} min (${rdv.heureDebut})`}
                                </span>
                            </div>

                            <button
                                type="button"
                                onClick={() => dismissAlert(rdv.id)}
                                style={{
                                    background: 'transparent',
                                    border: 'none',
                                    color: '#94a3b8',
                                    fontSize: 14,
                                    cursor: 'pointer',
                                    padding: '0 4px',
                                }}
                                title="Fermer"
                            >
                                ✕
                            </button>
                        </div>

                        {/* Client et détails */}
                        <div>
                            <div style={{ fontSize: 14, fontWeight: 700 }}>
                                {rdv.clientNom}
                            </div>
                            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                                {rdv.quiGere} • {rdv.type === 'visio' ? 'Visioconférence' : rdv.type === 'telephone' ? 'Appel' : 'Présentiel'}
                                {rdv.clientContact ? ` • ${rdv.clientContact}` : ''}
                            </div>
                            {rdv.notes && (
                                <div style={{ fontSize: 11, color: '#cbd5e1', marginTop: 4, fontStyle: 'italic' }}>
                                    « {rdv.notes} »
                                </div>
                            )}
                        </div>

                        {/* Actions */}
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                            {isVisio && rdv.lienVisio && (
                                <a
                                    href={rdv.lienVisio.startsWith('http') ? rdv.lienVisio : `https://${rdv.lienVisio}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="btn btn--primary btn--sm"
                                    style={{ padding: '3px 10px', fontSize: 11, fontWeight: 700 }}
                                    onClick={() => dismissAlert(rdv.id)}
                                >
                                    Rejoindre visio ↗
                                </a>
                            )}
                            <button
                                type="button"
                                onClick={() => {
                                    dismissAlert(rdv.id);
                                    navigate('/agenda');
                                }}
                                className="btn btn--secondary btn--sm"
                                style={{ padding: '3px 10px', fontSize: 11 }}
                            >
                                Ouvrir l'agenda
                            </button>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
