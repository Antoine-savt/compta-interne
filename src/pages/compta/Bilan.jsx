/**
 * Bilan.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Bilan comptable légal (norme PCG française) actualisé en temps réel.
 * Présente l'Actif et le Passif avec intégration automatique du Résultat Net
 * de l'exercice dans les capitaux propres.
 * Vérifie l'équilibre Actif = Passif.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { getEcrituresActives, calculerBilan, hasEcrituresCache } from '../../services/comptaService';
import { formatMontant, formatDate } from '../../services/helpers';

export default function Bilan() {
    const anneeCourante = new Date().getFullYear();
    const [dateDebut, setDateDebut] = useState(`${anneeCourante}-01-01`);
    const [dateFin, setDateFin] = useState(new Date().toISOString().split('T')[0]);
    const [ecritures, setEcritures] = useState([]);
    const [loading, setLoading] = useState(() => !hasEcrituresCache());
    const [detailComptes, setDetailComptes] = useState(true);

    const loadData = useCallback(async () => {
        if (!hasEcrituresCache()) {
            setLoading(true);
        }
        try {
            const data = await getEcrituresActives({ dateDebut, dateFin });
            setEcritures(data);
        } catch (err) {
            console.error('Erreur chargement écritures pour Bilan:', err);
        } finally {
            setLoading(false);
        }
    }, [dateDebut, dateFin]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const bilan = useMemo(() => {
        return calculerBilan(ecritures);
    }, [ecritures]);

    const { actif, passif, equilibre } = bilan;

    function handlePrint() {
        window.print();
    }

    return (
        <div>
            {/* Header */}
            <div className="page-header">
                <div>
                    <h1>Bilan comptable</h1>
                    <p>Situation patrimoniale de l'entreprise (Actif / Passif) actualisée en temps réel</p>
                </div>
                <div className="page-header__actions">
                    <button className="btn btn--ghost" onClick={() => setDetailComptes(!detailComptes)}>
                        {detailComptes ? 'Masquer détails des comptes' : 'Afficher détails des comptes'}
                    </button>
                    <button className="btn btn--ghost" onClick={handlePrint}>
                        Imprimer / PDF
                    </button>
                </div>
            </div>

            {/* Bannière de période visible uniquement à l'impression */}
            <div className="print-only" style={{ marginBottom: 16, fontSize: 13, color: '#374151', fontWeight: 600 }}>
                Période d'arrêté : du {dateDebut} au {dateFin}
            </div>

            {/* Barre de filtres de période */}
            <div className="card no-print" style={{ padding: '14px 20px', marginBottom: 20 }}>
                <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-muted)' }}>Période d'arrêté :</span>
                        <input
                            type="date"
                            className="form-input"
                            style={{ width: 140 }}
                            value={dateDebut}
                            onChange={(e) => setDateDebut(e.target.value)}
                        />
                        <span>au</span>
                        <input
                            type="date"
                            className="form-input"
                            style={{ width: 140 }}
                            value={dateFin}
                            onChange={(e) => setDateFin(e.target.value)}
                        />
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                        <button
                            className="btn btn--sm btn--ghost"
                            onClick={() => {
                                setDateDebut(`${anneeCourante}-01-01`);
                                setDateFin(`${anneeCourante}-12-31`);
                            }}
                        >
                            Exercice {anneeCourante}
                        </button>
                        <button
                            className="btn btn--sm btn--ghost"
                            onClick={() => {
                                setDateDebut(`${anneeCourante - 1}-01-01`);
                                setDateFin(`${anneeCourante - 1}-12-31`);
                            }}
                        >
                            Exercice {anneeCourante - 1}
                        </button>
                    </div>
                    <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
                        {ecritures.length} écriture(s) comptable(s) active(s)
                    </span>
                </div>
            </div>

            {/* Bannière de contrôle d'équilibre */}
            <div className={`notice ${equilibre.estEquilibre ? 'notice--success' : 'notice--danger'}`} style={{ marginBottom: 20 }}>
                {equilibre.estEquilibre ? (
                    <div>
                        <strong>Bilan équilibré :</strong> Total Actif ({formatMontant(actif.total)}) = Total Passif ({formatMontant(passif.total)}).
                        Le résultat de l'exercice ({formatMontant(passif.resultatNet)}) est intégré aux capitaux propres.
                    </div>
                ) : (
                    <div>
                        <strong>Écart d'équilibre détecté :</strong> Écart de {formatMontant(Math.abs(equilibre.ecart))} (Actif: {formatMontant(actif.total)} / Passif: {formatMontant(passif.total)}).
                        Vérifiez vos écritures manuelles ou lettrages.
                    </div>
                )}
            </div>

            {/* Grille Bilan Actif / Passif (2 colonnes) */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>

                {/* ─── COLONNE ACTIF ─── */}
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div style={{ padding: '16px 20px', background: '#f8fafc', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h2 style={{ fontSize: 16, margin: 0, color: 'var(--text)' }}>ACTIF</h2>
                        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)' }}>
                            {formatMontant(actif.total)}
                        </span>
                    </div>

                    <div style={{ padding: '16px 20px' }}>

                        {/* ACTIF IMMOBILISÉ */}
                        <div style={{ marginBottom: 20 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 13, borderBottom: '1px solid var(--border)', paddingBottom: 6, marginBottom: 8, color: 'var(--text-muted)' }}>
                                <span>ACTIF IMMOBILISÉ (Classe 2)</span>
                                <span>{formatMontant(actif.totalImmobilise)}</span>
                            </div>
                            {actif.immobilisations.length === 0 ? (
                                <p style={{ fontSize: 12, color: 'var(--text-light)', margin: '4px 0' }}>Aucune immobilisation enregistrée.</p>
                            ) : (
                                actif.immobilisations.map((c) => (
                                    <div key={c.compte} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0' }}>
                                        <span>
                                            {detailComptes && <code>{c.compte}</code>} {c.intitule}
                                        </span>
                                        <span style={{ fontWeight: 500 }}>{formatMontant(c.montant)}</span>
                                    </div>
                                ))
                            )}
                        </div>

                        {/* ACTIF CIRCULANT */}
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 13, borderBottom: '1px solid var(--border)', paddingBottom: 6, marginBottom: 8, color: 'var(--text-muted)' }}>
                                <span>ACTIF CIRCULANT</span>
                                <span>{formatMontant(actif.totalCirculant)}</span>
                            </div>

                            {/* Créances clients */}
                            <div style={{ marginBottom: 12 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                                    <span>Créances clients (Comptes 411)</span>
                                    <span>{formatMontant(actif.clients.reduce((s, c) => s + c.montant, 0))}</span>
                                </div>
                                {detailComptes && actif.clients.map((c) => (
                                    <div key={c.compte} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', paddingLeft: 12 }}>
                                        <span><code>{c.compte}</code> {c.intitule}</span>
                                        <span>{formatMontant(c.montant)}</span>
                                    </div>
                                ))}
                            </div>

                            {/* Autres créances */}
                            <div style={{ marginBottom: 12 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                                    <span>Autres créances (TVA déductible, acomptes...)</span>
                                    <span>{formatMontant(actif.autresCreances.reduce((s, c) => s + c.montant, 0))}</span>
                                </div>
                                {detailComptes && actif.autresCreances.map((c) => (
                                    <div key={c.compte} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', paddingLeft: 12 }}>
                                        <span><code>{c.compte}</code> {c.intitule}</span>
                                        <span>{formatMontant(c.montant)}</span>
                                    </div>
                                ))}
                            </div>

                            {/* Disponibilités */}
                            <div style={{ marginBottom: 8 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                                    <span>Disponibilités & Banque (Comptes 512, 530)</span>
                                    <span style={{ color: 'var(--success)' }}>{formatMontant(actif.totalDispo)}</span>
                                </div>
                                {detailComptes && actif.disponibilites.map((c) => (
                                    <div key={c.compte} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', paddingLeft: 12 }}>
                                        <span><code>{c.compte}</code> {c.intitule}</span>
                                        <span>{formatMontant(c.montant)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                    </div>

                    {/* Footer Actif */}
                    <div style={{ padding: '14px 20px', background: '#f1f5f9', borderTop: '2px solid var(--border)', display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 14 }}>
                        <span>TOTAL ACTIF</span>
                        <span style={{ color: 'var(--accent)' }}>{formatMontant(actif.total)}</span>
                    </div>
                </div>

                {/* ─── COLONNE PASSIF ─── */}
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div style={{ padding: '16px 20px', background: '#f8fafc', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h2 style={{ fontSize: 16, margin: 0, color: 'var(--text)' }}>PASSIF</h2>
                        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)' }}>
                            {formatMontant(passif.total)}
                        </span>
                    </div>

                    <div style={{ padding: '16px 20px' }}>

                        {/* CAPITAUX PROPRES */}
                        <div style={{ marginBottom: 20 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 13, borderBottom: '1px solid var(--border)', paddingBottom: 6, marginBottom: 8, color: 'var(--text-muted)' }}>
                                <span>CAPITAUX PROPRES (Classe 1)</span>
                                <span>{formatMontant(passif.totalCapitauxPropres)}</span>
                            </div>

                            {/* Capital et réserves */}
                            {passif.capitauxPropres.map((c) => (
                                <div key={c.compte} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0' }}>
                                    <span>{detailComptes && <code>{c.compte}</code>} {c.intitule}</span>
                                    <span style={{ fontWeight: 500 }}>{formatMontant(c.montant)}</span>
                                </div>
                            ))}

                            {/* Résultat Net de l'exercice */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 600, padding: '6px 8px', background: passif.resultatNet >= 0 ? '#f0fdf4' : '#fef2f2', borderRadius: 'var(--radius)', marginTop: 6 }}>
                                <span>
                                    Résultat net de l'exercice ({passif.resultatNet >= 0 ? 'Bénéfice' : 'Perte'})
                                </span>
                                <span style={{ color: passif.resultatNet >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                                    {formatMontant(passif.resultatNet)}
                                </span>
                            </div>
                        </div>

                        {/* DETTES */}
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 13, borderBottom: '1px solid var(--border)', paddingBottom: 6, marginBottom: 8, color: 'var(--text-muted)' }}>
                                <span>DETTES</span>
                                <span>{formatMontant(passif.totalDettes)}</span>
                            </div>

                            {/* Dettes financières & Comptes courants d'associés (455x) */}
                            <div style={{ marginBottom: 12 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                                    <span>Comptes courants d'associés & Dettes financières (455x, 16x)</span>
                                    <span style={{ color: 'var(--accent)' }}>
                                        {formatMontant(passif.dettesFinancieresCCA.reduce((s, c) => s + c.montant, 0))}
                                    </span>
                                </div>
                                {detailComptes && passif.dettesFinancieresCCA.map((c) => (
                                    <div key={c.compte} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', paddingLeft: 12 }}>
                                        <span><code>{c.compte}</code> {c.intitule}</span>
                                        <span>{formatMontant(c.montant)}</span>
                                    </div>
                                ))}
                            </div>

                            {/* Dettes fournisseurs */}
                            <div style={{ marginBottom: 12 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                                    <span>Dettes fournisseurs (Comptes 401)</span>
                                    <span>{formatMontant(passif.dettesFournisseurs.reduce((s, c) => s + c.montant, 0))}</span>
                                </div>
                                {detailComptes && passif.dettesFournisseurs.map((c) => (
                                    <div key={c.compte} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', paddingLeft: 12 }}>
                                        <span><code>{c.compte}</code> {c.intitule}</span>
                                        <span>{formatMontant(c.montant)}</span>
                                    </div>
                                ))}
                            </div>

                            {/* Dettes fiscales et sociales */}
                            <div style={{ marginBottom: 8 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                                    <span>Dettes fiscales & sociales (TVA collectée, URSSAF...)</span>
                                    <span>{formatMontant(passif.dettesFiscalesSociales.reduce((s, c) => s + c.montant, 0))}</span>
                                </div>
                                {detailComptes && passif.dettesFiscalesSociales.map((c) => (
                                    <div key={c.compte} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', paddingLeft: 12 }}>
                                        <span><code>{c.compte}</code> {c.intitule}</span>
                                        <span>{formatMontant(c.montant)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                    </div>

                    {/* Footer Passif */}
                    <div style={{ padding: '14px 20px', background: '#f1f5f9', borderTop: '2px solid var(--border)', display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 14 }}>
                        <span>TOTAL PASSIF</span>
                        <span style={{ color: 'var(--accent)' }}>{formatMontant(passif.total)}</span>
                    </div>
                </div>

            </div>
        </div>
    );
}
