/**
 * CategoriesClient.jsx  CRUD des catégories de clients
 * Créer, renommer, supprimer, réordonner, couleur par catégorie
 * Vue récapitulative : nombre de clients + total encaissé par catégorie
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    collection, query, orderBy, getDocs,
    addDoc, doc, updateDoc, deleteDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { formatMontant } from '../services/helpers';
import { getCached, setCached, invalidateCache } from '../services/dataCache';

const COULEURS_PRESET = [
    '#4f6ff0', '#22c55e', '#f59e0b', '#ef4444', '#38bdf8',
    '#a855f7', '#ec4899', '#14b8a6', '#fb923c', '#6366f1',
];

export default function CategoriesClient() {
    const navigate = useNavigate();
    const [categories, setCategories] = useState(() => getCached('categoriesClient') || []);
    const [clients, setClients] = useState(() => getCached('clients') || []);
    const [versements, setVersements] = useState(() => getCached('versementsStripe') || []);
    const [loading, setLoading] = useState(() => !getCached('categoriesClient'));

    // Formulaire ajout / édition
    const [editId, setEditId] = useState(null); // null = nouveau
    const [formNom, setFormNom] = useState('');
    const [formCoul, setFormCoul] = useState(COULEURS_PRESET[0]);
    const [showForm, setShowForm] = useState(false);
    const [saving, setSaving] = useState(false);

    const [factures, setFactures] = useState([]);
    const [facturations, setFacturations] = useState([]);
    const [depenses, setDepenses] = useState([]);

    async function load() {
        try {
            const [catSnap, cliSnap, versSnap, factSnap, factuSnap, depSnap] = await Promise.all([
                getDocs(query(collection(db, 'categoriesClient'), orderBy('ordre'))),
                getDocs(collection(db, 'clients')),
                getDocs(collection(db, 'versementsStripe')),
                getDocs(collection(db, 'factures')),
                getDocs(collection(db, 'facturations')),
                getDocs(collection(db, 'depenses')),
            ]);
            const cats = catSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
            const clis = cliSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
            const vers = versSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
            const facts = factSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
            const factus = factuSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
            const deps = depSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

            setCategories(cats);
            setClients(clis);
            setVersements(vers);
            setFactures(facts);
            setFacturations(factus);
            setDepenses(deps);

            setCached('categoriesClient', cats);
            setCached('versementsStripe', vers);
        } catch (err) {
            console.error('Erreur chargement categories:', err);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => { load(); }, []);

    // Agrégats par catégorie (Recettes facturées, Dépenses affectées, Marge nette)
    function stats(catId) {
        const catClients = clients.filter((c) => catId ? c.categorieId === catId : !c.categorieId);
        const cliIds = catClients.map((c) => c.id);
        const cliNames = catClients.map((c) => (c.nom || '').toLowerCase());
        const nbClients = cliIds.length;

        const totalFact = factures
            .filter((f) => cliIds.includes(f.clientId) || (f.clientNom && cliNames.includes(f.clientNom.toLowerCase())))
            .reduce((s, f) => s + (f.totalTTC ?? f.totalFacture ?? 0), 0);

        const totalFactu = facturations
            .filter((f) => cliIds.includes(f.clientId) || (f.clientNom && cliNames.includes(f.clientNom.toLowerCase())))
            .reduce((s, f) => s + (f.totalFacture ?? f.totalTTC ?? f.montant ?? 0), 0);

        const totalVers = versements
            .filter((v) => cliIds.includes(v.clientId) || (v.clientNom && cliNames.includes(v.clientNom.toLowerCase())))
            .reduce((s, v) => s + (v.montantBrut ?? 0), 0);

        const totalRecettes = Math.max(totalFact + totalFactu, totalVers);

        const totalDep = depenses
            .filter((d) => cliIds.includes(d.clientProjetId) || cliIds.includes(d.clientId) || (d.clientProjetNom && cliNames.includes(d.clientProjetNom.toLowerCase())))
            .reduce((s, d) => s + (d.montantTTC ?? d.montant ?? 0), 0);

        const margeNette = totalRecettes - totalDep;

        return { nbClients, totalEnc: totalRecettes, totalDep, margeNette };
    }

    function startEdit(cat) {
        setEditId(cat.id);
        setFormNom(cat.nom);
        setFormCoul(cat.couleur ?? COULEURS_PRESET[0]);
        setShowForm(true);
    }

    function startNew() {
        setEditId(null);
        setFormNom('');
        setFormCoul(COULEURS_PRESET[categories.length % COULEURS_PRESET.length]);
        setShowForm(true);
    }

    async function handleSave() {
        const nom = formNom.trim();
        if (!nom) return;
        const coul = formCoul;

        // Fermeture immédiate du formulaire (0 ms)
        setShowForm(false);

        if (editId) {
            // 1. Mise à jour optimiste INSTANTANÉE (0 ms)
            const updated = categories.map((c) => (c.id === editId ? { ...c, nom, couleur: coul } : c));
            setCategories(updated);
            setCached('categoriesClient', updated);

            // 2. Persistance en arrière-plan
            updateDoc(doc(db, 'categoriesClient', editId), {
                nom, couleur: coul, updatedAt: serverTimestamp(),
            }).catch((err) => {
                console.error('Erreur mise à jour catégorie:', err);
                load();
            });
        } else {
            const tempId = 'temp_' + Date.now();
            const newCat = {
                id: tempId,
                nom,
                couleur: coul,
                ordre: categories.length + 1,
            };
            // 1. Ajout optimiste INSTANTANÉ (0 ms)
            const updated = [...categories, newCat];
            setCategories(updated);
            setCached('categoriesClient', updated);

            // 2. Persistance en arrière-plan
            addDoc(collection(db, 'categoriesClient'), {
                nom, couleur: coul,
                ordre: categories.length + 1,
                createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
            }).then((docRef) => {
                setCategories((prev) => {
                    const next = prev.map((c) => (c.id === tempId ? { ...c, id: docRef.id } : c));
                    setCached('categoriesClient', next);
                    return next;
                });
            }).catch((err) => {
                console.error('Erreur ajout catégorie:', err);
                load();
            });
        }
    }

    async function handleDelete(catId) {
        const { nbClients } = stats(catId);
        if (nbClients > 0) {
            const ok = window.confirm(`Cette catégorie contient ${nbClients} client(s). Ils seront mis en "Non catégorisé". Continuer ?`);
            if (!ok) return;

            // Mise à jour optimiste des clients rattachés (0 ms)
            const updatedClients = clients.map((c) =>
                c.categorieId === catId ? { ...c, categorieId: null, categorieNom: null } : c
            );
            setClients(updatedClients);
            setCached('clients', updatedClients);

            for (const c of clients.filter((c) => c.categorieId === catId)) {
                updateDoc(doc(db, 'clients', c.id), {
                    categorieId: null, categorieNom: null, updatedAt: serverTimestamp(),
                }).catch(() => {});
            }
        }

        // Suppression optimiste INSTANTANÉE (0 ms)
        const updated = categories.filter((c) => c.id !== catId);
        setCategories(updated);
        setCached('categoriesClient', updated);

        deleteDoc(doc(db, 'categoriesClient', catId)).catch((err) => {
            console.error('Erreur suppression catégorie:', err);
            load();
        });
    }

    async function moveUp(idx) {
        if (idx === 0) return;
        const updated = [...categories];
        [updated[idx - 1], updated[idx]] = [updated[idx], updated[idx - 1]];
        updated.forEach((c, i) => { c.ordre = i + 1; });

        // Mise à jour optimiste INSTANTANÉE (0 ms)
        setCategories(updated);
        setCached('categoriesClient', updated);

        // Persistance en arrière-plan
        Promise.all(updated.map((c, i) => updateDoc(doc(db, 'categoriesClient', c.id), { ordre: i + 1 }))).catch((err) => {
            console.error('Erreur réordonnancement catégories:', err);
            load();
        });
    }

    async function moveDown(idx) {
        if (idx === categories.length - 1) return;
        const updated = [...categories];
        [updated[idx], updated[idx + 1]] = [updated[idx + 1], updated[idx]];
        updated.forEach((c, i) => { c.ordre = i + 1; });

        // Mise à jour optimiste INSTANTANÉE (0 ms)
        setCategories(updated);
        setCached('categoriesClient', updated);

        // Persistance en arrière-plan
        Promise.all(updated.map((c, i) => updateDoc(doc(db, 'categoriesClient', c.id), { ordre: i + 1 }))).catch((err) => {
            console.error('Erreur réordonnancement catégories:', err);
            load();
        });
    }

    const noncategorises = clients.filter((c) => !c.categorieId);
    const totalEncNonCat = versements
        .filter((v) => noncategorises.some((c) => c.id === v.clientId))
        .reduce((s, v) => s + (v.montantBrut ?? 0), 0);

    return (
        <div>
            <div className="page-header">
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <button className="btn btn--ghost btn--sm" onClick={() => navigate('/clients')}> Clients</button>
                    <h1 style={{ margin: 0 }}>Catégories de clients</h1>
                </div>
                <div className="page-header__actions">
                    <button className="btn btn--primary" onClick={startNew}>+ Nouvelle catégorie</button>
                </div>
            </div>

            {/* Formulaire inline */}
            {showForm && (
                <div className="card" style={{ marginBottom: 16, borderColor: 'var(--border-focus)' }}>
                    <div className="card__title">{editId ? 'Modifier la catégorie' : 'Nouvelle catégorie'}</div>
                    <div className="form-row">
                        <div className="form-group">
                            <label className="form-label">Nom</label>
                            <input type="text" className="form-input" value={formNom} onChange={(e) => setFormNom(e.target.value)} placeholder="Ex. Abonnés premium" autoFocus />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Couleur</label>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                                {COULEURS_PRESET.map((c) => (
                                    <button
                                        key={c} type="button"
                                        style={{
                                            width: 28, height: 28, borderRadius: '50%', background: c, border: 'none',
                                            cursor: 'pointer', outline: formCoul === c ? `3px solid ${c}` : 'none',
                                            outlineOffset: 2,
                                        }}
                                        onClick={() => setFormCoul(c)}
                                    />
                                ))}
                                <input type="color" value={formCoul} onChange={(e) => setFormCoul(e.target.value)} style={{ width: 28, height: 28, borderRadius: '50%', border: 'none', cursor: 'pointer', padding: 0 }} title="Couleur personnalisée" />
                            </div>
                        </div>
                    </div>
                    <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ width: 14, height: 14, borderRadius: '50%', background: formCoul, display: 'inline-block', flexShrink: 0 }} />
                        <span className="badge" style={{ background: formCoul + '22', color: formCoul, border: `1px solid ${formCoul}55` }}>{formNom || 'Aperçu'}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                        <button className="btn btn--primary btn--sm" disabled={saving || !formNom.trim()} onClick={handleSave}>{saving ? '' : editId ? 'Enregistrer' : 'Créer'}</button>
                        <button className="btn btn--ghost btn--sm" onClick={() => setShowForm(false)}>Annuler</button>
                    </div>
                </div>
            )}

            {loading && <p style={{ color: 'var(--text-muted)' }}>Chargement</p>}

            {/* Tableau des catégories */}
            {!loading && (
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div className="table-wrap">
                        <table>
                            <thead>
                                <tr>
                                    <th style={{ width: 40 }}></th>
                                    <th>Catégorie</th>
                                    <th style={{ textAlign: 'right' }}>Clients</th>
                                    <th style={{ textAlign: 'right' }}>Recettes</th>
                                    <th style={{ textAlign: 'right' }}>Dépenses</th>
                                    <th style={{ textAlign: 'right' }}>Marge nette</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {categories.map((cat, idx) => {
                                    const { nbClients, totalEnc, totalDep, margeNette } = stats(cat.id);
                                    return (
                                        <tr key={cat.id}>
                                            <td>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                                    <button className="btn btn--icon btn--ghost" style={{ padding: '2px 6px', fontSize: 10 }} onClick={() => moveUp(idx)} disabled={idx === 0}>▲</button>
                                                    <button className="btn btn--icon btn--ghost" style={{ padding: '2px 6px', fontSize: 10 }} onClick={() => moveDown(idx)} disabled={idx === categories.length - 1}>▼</button>
                                                </div>
                                            </td>
                                            <td>
                                                <span className="badge" style={{ background: cat.couleur + '22', color: cat.couleur, border: `1px solid ${cat.couleur}55` }}>
                                                    {cat.nom}
                                                </span>
                                            </td>
                                            <td style={{ textAlign: 'right' }}>{nbClients}</td>
                                            <td style={{ textAlign: 'right', fontWeight: 500 }}>{formatMontant(totalEnc)}</td>
                                            <td style={{ textAlign: 'right', color: 'var(--danger)' }}>{totalDep > 0 ? `− ${formatMontant(totalDep)}` : '—'}</td>
                                            <td style={{ textAlign: 'right', fontWeight: 600, color: margeNette >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                                                {formatMontant(margeNette)}
                                            </td>
                                            <td>
                                                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                                                    <button className="btn btn--sm btn--ghost" onClick={() => startEdit(cat)}>Modifier</button>
                                                    <button className="btn btn--sm btn--danger" onClick={() => handleDelete(cat.id)}>Supprimer</button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                                {/* Ligne "Non catégorisé" */}
                                {(() => {
                                    const nonCatStats = stats(null);
                                    return (
                                        <tr style={{ opacity: 0.8, background: 'var(--bg2)' }}>
                                            <td></td>
                                            <td><span className="badge badge--muted">Non catégorisé</span></td>
                                            <td style={{ textAlign: 'right' }}>{nonCatStats.nbClients}</td>
                                            <td style={{ textAlign: 'right' }}>{formatMontant(nonCatStats.totalEnc)}</td>
                                            <td style={{ textAlign: 'right', color: 'var(--danger)' }}>{nonCatStats.totalDep > 0 ? `− ${formatMontant(nonCatStats.totalDep)}` : '—'}</td>
                                            <td style={{ textAlign: 'right', fontWeight: 600, color: nonCatStats.margeNette >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                                                {formatMontant(nonCatStats.margeNette)}
                                            </td>
                                            <td></td>
                                        </tr>
                                    );
                                })()}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
