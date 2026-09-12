/**
 * CompteResultat.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Compte de Résultat légal (norme PCG française) actualisé en temps réel.
 * Présente le détail des Produits (classe 7) et Charges (classe 6),
 * les Soldes Intermédiaires de Gestion (SIG) et le Résultat Net de l'exercice.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { getEcrituresActives, calculerCompteResultat, hasEcrituresCache } from '../../services/comptaService';
import { formatMontant } from '../../services/helpers';

export default function CompteResultat() {
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
            console.error('Erreur chargement écritures pour Compte de résultat:', err);
        } finally {
            setLoading(false);
        }
    }, [dateDebut, dateFin]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const cr = useMemo(() => {
        return calculerCompteResultat(ecritures);
    }, [ecritures]);

    const { charges, produits, sig } = cr;

    function handlePrint() {
        window.print();
    }

    return (
        <div>
            {/* Header */}
            <div className="page-header">
                <div>
                    <h1>Compte de résultat</h1>
                    <p>Activité et performance économique (Produits, Charges et Résultat net) en temps réel</p>
                </div>
                <div className="page-header__actions">
                    <button className="btn btn--ghost" onClick={() => setDetailComptes(!detailComptes)}>
                        {detailComptes ? 'Masquer détails des comptes' : 'Afficher détails des comptes'}
                    </button>
                    <button className="btn btn--ghost" onClick={handlePrint}>
                        🖨️ Imprimer / PDF
                    </button>
                </div>
            </div>

            {/* Barre de filtres de période */}
            <div className="card" style={{ padding: '14px 20px', marginBottom: 20 }}>
                <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-muted)' }}>Période :</span>
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
                </div>
            </div>

            {/* Cartes Soldes Intermédiaires de Gestion */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
                <div className="card" style={{ padding: '14px 18px', marginBottom: 0 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
                        Chiffre d'affaires (Produits)
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--success)' }}>
                        {formatMontant(produits.totalGlobal)}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Classe 7 (Ventes / Prestations)</div>
                </div>

                <div className="card" style={{ padding: '14px 18px', marginBottom: 0 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
                        Total des charges
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--danger)' }}>
                        {formatMontant(charges.totalGlobal)}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Classe 6 (Exploitation, Frais, CCA)</div>
                </div>

                <div className="card" style={{ padding: '14px 18px', marginBottom: 0 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
                        Résultat d'exploitation
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: sig.resultatExploitation >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                        {formatMontant(sig.resultatExploitation)}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Produits expl. - Charges expl.</div>
                </div>

                <div className="card" style={{ padding: '14px 18px', marginBottom: 0, border: `2px solid ${sig.estBenefice ? 'var(--success)' : 'var(--danger)'}` }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
                        Résultat Net ({sig.estBenefice ? 'Bénéfice' : 'Perte'})
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: sig.estBenefice ? 'var(--success)' : 'var(--danger)' }}>
                        {formatMontant(sig.resultatNet)}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Produits totaux - Charges totales</div>
                </div>
            </div>

            {/* Grille Charges / Produits (2 colonnes) */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>

                {/* ─── CHARGES (Classe 6) ─── */}
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div style={{ padding: '16px 20px', background: '#fef2f2', borderBottom: '1px solid #fecaca', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h2 style={{ fontSize: 16, margin: 0, color: 'var(--danger)' }}>CHARGES (Classe 6)</h2>
                        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--danger)' }}>
                            {formatMontant(charges.totalGlobal)}
                        </span>
                    </div>

                    <div style={{ padding: '16px 20px' }}>

                        {/* Charges d'exploitation */}
                        <div style={{ marginBottom: 16 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 13, borderBottom: '1px solid var(--border)', paddingBottom: 6, marginBottom: 8 }}>
                                <span>Charges d'exploitation</span>
                                <span>{formatMontant(charges.totalExploitation)}</span>
                            </div>
                            {charges.exploitation.length === 0 ? (
                                <p style={{ fontSize: 12, color: 'var(--text-light)' }}>Aucune charge d'exploitation.</p>
                            ) : (
                                charges.exploitation.map((c) => (
                                    <div key={c.compte} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0' }}>
                                        <span>{detailComptes && <code>{c.compte}</code>} {c.intitule}</span>
                                        <span style={{ fontWeight: 500 }}>{formatMontant(c.montant)}</span>
                                    </div>
                                ))
                            )}
                        </div>

                        {/* Charges financières (dont 6615 Intérêts CCA) */}
                        <div style={{ marginBottom: 16 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 13, borderBottom: '1px solid var(--border)', paddingBottom: 6, marginBottom: 8 }}>
                                <span>Charges financières (dont Intérêts CCA 6615)</span>
                                <span>{formatMontant(charges.totalFinancieres)}</span>
                            </div>
                            {charges.financieres.length === 0 ? (
                                <p style={{ fontSize: 12, color: 'var(--text-light)' }}>Aucune charge financière.</p>
                            ) : (
                                charges.financieres.map((c) => (
                                    <div key={c.compte} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0' }}>
                                        <span>{detailComptes && <code>{c.compte}</code>} {c.intitule}</span>
                                        <span style={{ fontWeight: 500 }}>{formatMontant(c.montant)}</span>
                                    </div>
                                ))
                            )}
                        </div>

                        {/* Charges exceptionnelles */}
                        {charges.exceptionnelles.length > 0 && (
                            <div style={{ marginBottom: 16 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 13, borderBottom: '1px solid var(--border)', paddingBottom: 6, marginBottom: 8 }}>
                                    <span>Charges exceptionnelles</span>
                                    <span>{formatMontant(charges.totalExceptionnelles)}</span>
                                </div>
                                {charges.exceptionnelles.map((c) => (
                                    <div key={c.compte} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0' }}>
                                        <span>{detailComptes && <code>{c.compte}</code>} {c.intitule}</span>
                                        <span style={{ fontWeight: 500 }}>{formatMontant(c.montant)}</span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Dotations aux amortissements */}
                        {charges.dotations.length > 0 && (
                            <div style={{ marginBottom: 16 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 13, borderBottom: '1px solid var(--border)', paddingBottom: 6, marginBottom: 8 }}>
                                    <span>Dotations aux amortissements (68)</span>
                                    <span>{formatMontant(charges.totalDotations)}</span>
                                </div>
                                {charges.dotations.map((c) => (
                                    <div key={c.compte} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0' }}>
                                        <span>{detailComptes && <code>{c.compte}</code>} {c.intitule}</span>
                                        <span style={{ fontWeight: 500 }}>{formatMontant(c.montant)}</span>
                                    </div>
                                ))}
                            </div>
                        )}

                    </div>

                    <div style={{ padding: '14px 20px', background: '#fef2f2', borderTop: '2px solid #fecaca', display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 14 }}>
                        <span>TOTAL CHARGES</span>
                        <span style={{ color: 'var(--danger)' }}>{formatMontant(charges.totalGlobal)}</span>
                    </div>
                </div>

                {/* ─── PRODUITS (Classe 7) ─── */}
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div style={{ padding: '16px 20px', background: '#f0fdf4', borderBottom: '1px solid #bbf7d0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h2 style={{ fontSize: 16, margin: 0, color: 'var(--success)' }}>PRODUITS (Classe 7)</h2>
                        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--success)' }}>
                            {formatMontant(produits.totalGlobal)}
                        </span>
                    </div>

                    <div style={{ padding: '16px 20px' }}>

                        {/* Produits d'exploitation */}
                        <div style={{ marginBottom: 16 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 13, borderBottom: '1px solid var(--border)', paddingBottom: 6, marginBottom: 8 }}>
                                <span>Produits d'exploitation (Chiffre d'affaires)</span>
                                <span>{formatMontant(produits.totalExploitation)}</span>
                            </div>
                            {produits.exploitation.length === 0 ? (
                                <p style={{ fontSize: 12, color: 'var(--text-light)' }}>Aucun produit d'exploitation.</p>
                            ) : (
                                produits.exploitation.map((c) => (
                                    <div key={c.compte} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0' }}>
                                        <span>{detailComptes && <code>{c.compte}</code>} {c.intitule}</span>
                                        <span style={{ fontWeight: 500 }}>{formatMontant(c.montant)}</span>
                                    </div>
                                ))
                            )}
                        </div>

                        {/* Produits financiers */}
                        <div style={{ marginBottom: 16 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 13, borderBottom: '1px solid var(--border)', paddingBottom: 6, marginBottom: 8 }}>
                                <span>Produits financiers (76)</span>
                                <span>{formatMontant(produits.totalFinanciers)}</span>
                            </div>
                            {produits.financiers.length === 0 ? (
                                <p style={{ fontSize: 12, color: 'var(--text-light)' }}>Aucun produit financier.</p>
                            ) : (
                                produits.financiers.map((c) => (
                                    <div key={c.compte} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0' }}>
                                        <span>{detailComptes && <code>{c.compte}</code>} {c.intitule}</span>
                                        <span style={{ fontWeight: 500 }}>{formatMontant(c.montant)}</span>
                                    </div>
                                ))
                            )}
                        </div>

                        {/* Produits exceptionnels */}
                        {produits.exceptionnels.length > 0 && (
                            <div style={{ marginBottom: 16 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 13, borderBottom: '1px solid var(--border)', paddingBottom: 6, marginBottom: 8 }}>
                                    <span>Produits exceptionnels (77)</span>
                                    <span>{formatMontant(produits.totalExceptionnels)}</span>
                                </div>
                                {produits.exceptionnels.map((c) => (
                                    <div key={c.compte} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0' }}>
                                        <span>{detailComptes && <code>{c.compte}</code>} {c.intitule}</span>
                                        <span style={{ fontWeight: 500 }}>{formatMontant(c.montant)}</span>
                                    </div>
                                ))}
                            </div>
                        )}

                    </div>

                    <div style={{ padding: '14px 20px', background: '#f0fdf4', borderTop: '2px solid #bbf7d0', display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 14 }}>
                        <span>TOTAL PRODUITS</span>
                        <span style={{ color: 'var(--success)' }}>{formatMontant(produits.totalGlobal)}</span>
                    </div>
                </div>

            </div>
        </div>
    );
}
