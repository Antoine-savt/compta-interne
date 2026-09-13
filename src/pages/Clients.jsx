/**
 * Clients.jsx — Annuaire & Gestionnaire des Clients et Sites Internet
 * Filtres par catégorie, recherche multi-critères, et statut de site
 * Affichage direct du site internet, du prochain rendez-vous et du CA / MRR
 * 
 * Contrainte stricte : AUCUN EMOJI. Design sobre, épuré et efficace.
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    collection, query, orderBy, getDocs,
    doc, updateDoc, serverTimestamp, addDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import { formatMontant, formatDate } from '../services/helpers';
import { getCached, setCached } from '../services/dataCache';

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
            Chargement des clients...
        </div>
    );
}

// Statuts du site internet
const SITE_STATUTS = [
    { id: 'en_ligne', label: 'En ligne', cls: 'status-tag--online' },
    { id: 'en_dev', label: 'En développement', cls: 'status-tag--dev' },
    { id: 'en_recette', label: 'En recette', cls: 'status-tag--recette' },
    { id: 'en_refonte', label: 'En refonte', cls: 'status-tag--refonte' },
    { id: 'maintenance', label: 'Maintenance', cls: 'status-tag--maint' },
    { id: 'hors_ligne', label: 'Hors ligne', cls: 'status-tag--offline' },
];

export default function Clients() {
    const navigate = useNavigate();
    const [clients, setClients] = useState(() => getCached('clients') || []);
    const [categories, setCategories] = useState(() => getCached('categoriesClient') || []);
    const [loading, setLoading] = useState(() => !getCached('clients'));
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

    const load = useCallback(async () => {
        try {
            const [cliSnap, catSnap, factSnap, versSnap] = await Promise.all([
                getDocs(query(collection(db, 'clients'), orderBy('nom'))),
                getDocs(query(collection(db, 'categoriesClient'), orderBy('ordre'))),
                getDocs(collection(db, 'factures')),
                getDocs(collection(db, 'versementsStripe')),
            ]);

            const cats = catSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
            setCategories(cats);
            setCached('categoriesClient', cats);

            // Totaux factures
            const totauxFactures = {};
            factSnap.docs.forEach((d) => {
                const f = d.data();
                if (!f.clientId) return;
                totauxFactures[f.clientId] = (totauxFactures[f.clientId] ?? 0) + (f.totalTTC ?? 0);
            });

            // Versements Stripe & abonnements
            const totauxStripe = {};
            const abosParClient = {};
            versSnap.docs.forEach((d) => {
                const v = d.data();
                if (!v.clientId) return;
                totauxStripe[v.clientId] = (totauxStripe[v.clientId] ?? 0) + (v.montantBrut ?? 0);
                if (v.recurrence?.type === 'recurrent' && v.abonnementMensuelEstime) {
                    abosParClient[v.clientId] = Math.max(
                        abosParClient[v.clientId] ?? 0,
                        v.abonnementMensuelEstime
                    );
                }
            });

            const clientsList = cliSnap.docs.map((d) => {
                const data = d.data();
                const totalCA = Math.max(totauxFactures[d.id] ?? 0, totauxStripe[d.id] ?? 0);
                const mrr = data.abonnementMensuelManuel
                    ? parseFloat(data.abonnementMensuelManuel)
                    : (abosParClient[d.id] ?? 0);

                return {
                    id: d.id,
                    ...data,
                    totalFacture: totauxFactures[d.id] ?? 0,
                    totalEncaisse: totalCA,
                    abonnementMensuel: mrr,
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
    const filtered = clients.filter((c) => {
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
            abonnementMensuel: parseFloat(newClient.abonnementMensuelManuel) || 0,
            taches: [],
            historiqueEchanges: [],
        };

        // Mise à jour optimiste
        setClients((prev) => {
            const next = [clientToAdd, ...prev].sort((a, b) => (a.nom || '').localeCompare(b.nom || ''));
            setCached('clients', next);
            return next;
        });
        setShowNewModal(false);

        // Reset formulaire
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

        // Persistance Firestore
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

    const catMap = Object.fromEntries(categories.map((c) => [c.id, c]));

    return (
        <div>
            <div className="page-header">
                <div>
                    <h1 style={{ margin: 0 }}>Clients & Sites</h1>
                    <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>
                        Gestionnaire opérationnel des clients, sites internet, rendez-vous et facturation.
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

            {/* Filtres & Recherche */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                    type="text"
                    className="form-input"
                    placeholder="Rechercher par nom, site, contact..."
                    style={{ maxWidth: 280 }}
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
            </div>

            {loading && <Spinner />}

            {/* Tableau des clients */}
            {!loading && (
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div className="table-wrap">
                        <table>
                            <thead>
                                <tr>
                                    <th>Client & Contact</th>
                                    <th>Site Internet</th>
                                    <th>Prochain rendez-vous</th>
                                    <th>Catégorie</th>
                                    <th style={{ textAlign: 'right' }}>Total facturé</th>
                                    <th style={{ textAlign: 'right' }}>Forfait mensuel</th>
                                    <th style={{ textAlign: 'right' }}>Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.length === 0 && (
                                    <tr>
                                        <td colSpan={7} style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 32 }}>
                                            Aucun client ne correspond à votre recherche.
                                        </td>
                                    </tr>
                                )}
                                {filtered.map((c) => {
                                    const cat = catMap[c.categorieId];
                                    const siteStatut = SITE_STATUTS.find((s) => s.id === c.siteStatut) || SITE_STATUTS[0];
                                    const contactComplet = [c.contactPrenom, c.contactNom].filter(Boolean).join(' ');

                                    return (
                                        <tr
                                            key={c.id}
                                            style={{ cursor: 'pointer' }}
                                            onClick={() => navigate(`/clients/${c.id}`)}
                                        >
                                            {/* Nom & Contact */}
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

                                            {/* Site Internet & Statut */}
                                            <td>
                                                {c.siteUrl ? (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
                                                        <a
                                                            href={c.siteUrl.startsWith('http') ? c.siteUrl : `https://${c.siteUrl}`}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            style={{ fontWeight: 500, fontSize: 13, color: 'var(--accent)' }}
                                                            onClick={(e) => e.stopPropagation()}
                                                        >
                                                            {c.siteUrl.replace(/^https?:\/\//, '')} [↗]
                                                        </a>
                                                        <span className={`status-tag ${siteStatut.cls}`} style={{ fontSize: 10, padding: '1px 6px' }}>
                                                            {siteStatut.label}
                                                        </span>
                                                    </div>
                                                ) : (
                                                    <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Non configuré</span>
                                                )}
                                            </td>

                                            {/* Prochain Rendez-vous */}
                                            <td>
                                                {c.prochainRdvDate ? (
                                                    <div>
                                                        <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--text)' }}>
                                                            {formatDate(c.prochainRdvDate)} {c.prochainRdvHeure ? `à ${c.prochainRdvHeure}` : ''}
                                                        </div>
                                                        <div style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }}>
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
                                                        maxWidth: 150, padding: '3px 6px', fontSize: 12,
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
                                                {c.totalFacture || c.totalEncaisse ? formatMontant(c.totalFacture || c.totalEncaisse) : '—'}
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
            )}

            {/* Synthèse en bas de page */}
            {!loading && filtered.length > 0 && (
                <div style={{ marginTop: 12, display: 'flex', gap: 24, fontSize: 13, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                    <span>
                        <strong style={{ color: 'var(--text)' }}>{filtered.length}</strong> client{filtered.length > 1 ? 's' : ''}
                    </span>
                    <span>
                        Total facturé : <strong style={{ color: 'var(--text)' }}>{formatMontant(filtered.reduce((s, c) => s + (c.totalFacture || c.totalEncaisse || 0), 0))}</strong>
                    </span>
                    <span>
                        MRR récurrent : <strong style={{ color: 'var(--accent)' }}>{formatMontant(filtered.reduce((s, c) => s + (c.abonnementMensuel || 0), 0))} / mois</strong>
                    </span>
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
