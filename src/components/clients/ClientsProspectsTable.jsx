/**
 * ClientsProspectsTable.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Tableur haute densité (Style Google Sheets / ClickUp)
 * - Pleine largeur d'écran sans barre de scroll encombrante
 * - Vrai quadrillage net
 * - Ajout de colonne simple via le bouton "+" de l'en-tête (texte libre ou statut)
 * - Modification du nom d'une colonne en écriture libre directe d'un simple clic
 * - Colonnes interchangeables (Drag & Drop natif + flèches ◀ / ▶)
 * - Gestion complète des colonnes (suppression directe en 2 étapes, masquage/restauration)
 * - Gestion dédiée des gestionnaires (équipe)
 * - Barre d'actions groupées propre, lisible et soignée
 * - Ajout et suppression ultra-rapides de lignes
 * 
 * Contrainte stricte : AUCUN EMOJI. Design sobre, dense et épuré.
 */
import { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
    doc, updateDoc, deleteDoc, addDoc, collection, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { formatDate, formatMontant } from '../../services/helpers';
import { saveCustomColumns } from '../../services/crmCustomColumnsService';
import { DateInput } from '../common/DateInput';
import ModalManageCustomColumns from './ModalManageCustomColumns';
import ModalManageGestionnaires from './ModalManageGestionnaires';
import ModalCreateRdv from '../agenda/ModalCreateRdv';
import ModalQuickAvailability from './ModalQuickAvailability';
import { getAllRendezVous } from '../../services/rdvService';

// Définition des colonnes standard préconfigurées
const STANDARD_COLUMNS = [
    { key: 'nom', label: 'Nom / Établissement', minWidth: 160 },
    { key: 'contact', label: 'Contact', minWidth: 130 },
    { key: 'telephone', label: 'Téléphone', minWidth: 110 },
    { key: 'email', label: 'Email', minWidth: 150 },
    { key: 'siteUrl', label: 'Site Web', minWidth: 120 },
    { key: 'quiGere', label: 'Qui gère', minWidth: 120 },
    { key: 'statutGlobal', label: 'Statut global', minWidth: 110 },
    { key: 'categorieId', label: 'Catégorie', minWidth: 120 },
    { key: 'dernierContactDate', label: 'Dernier contact', minWidth: 110 },
    { key: 'prochainRdvDate', label: 'Prochain RDV', minWidth: 140 },
    { key: 'prochaineAction', label: 'Prochaine action', minWidth: 150 },
    { key: 'mrr', label: 'MRR (€)', minWidth: 110, align: 'right' },
    { key: 'notes', label: 'Notes', minWidth: 130 },
];

const DEFAULT_COLUMN_KEYS = STANDARD_COLUMNS.map((c) => c.key);

// Définition des statuts globaux
const STATUTS_GLOBAUX = [
    { id: 'prospect', label: 'Prospect', color: '#b45309', bg: '#fef3c7', border: '#fcd34d' },
    { id: 'client_actif', label: 'Client actif', color: '#047857', bg: '#d1fae5', border: '#6ee7b7' },
    { id: 'client_inactif', label: 'Client inactif', color: '#475569', bg: '#f1f5f9', border: '#cbd5e1' },
];

export default function ClientsProspectsTable({
    clients = [],
    setClients,
    categories = [],
    associes = [],
    gestionnaires = [],
    setGestionnaires,
    customColumns = [],
    setCustomColumns,
    onReload,
}) {
    const navigate = useNavigate();

    // ─── Filtrage & Recherche ────────────────────────────────────────────────
    const [segmentFiltre, setSegmentFiltre] = useState('tous'); // 'tous' | 'prospect' | 'client_actif' | 'client_inactif'
    const [search, setSearch] = useState('');
    const [catFiltreId, setCatFiltreId] = useState('');
    const [quiGereFiltre, setQuiGereFiltre] = useState('');

    // ─── Tri ─────────────────────────────────────────────────────────────────
    const [sortField, setSortField] = useState('nom');
    const [sortDirection, setSortDirection] = useState('asc'); // 'asc' | 'desc'

    // ─── Sélection multiple ──────────────────────────────────────────────────
    const [selectedIds, setSelectedIds] = useState(new Set());

    // ─── Modales ─────────────────────────────────────────────────────────────
    const [showColModal, setShowColModal] = useState(false);
    const [showGestionnairesModal, setShowGestionnairesModal] = useState(false);
    const [showQuickAvailModal, setShowQuickAvailModal] = useState(false);
    const [selectedClientForRdv, setSelectedClientForRdv] = useState(null);
    const [allRdvs, setAllRdvs] = useState([]);

    useEffect(() => {
        getAllRendezVous().then(setAllRdvs).catch(console.error);
    }, []);

    // ─── Popovers de statut personnalisé (Portal fixed au body) ──────────────
    const [activeDropdown, setActiveDropdown] = useState(null);
    const popoverRef = useRef(null);

    // ─── Colonnes masquées ───────────────────────────────────────────────────
    const [hiddenStandardCols, setHiddenStandardCols] = useState(() => {
        try {
            const saved = localStorage.getItem('crm_hidden_standard_cols');
            return saved ? JSON.parse(saved) : [];
        } catch {
            return [];
        }
    });
    const [showAddColMenu, setShowAddColMenu] = useState(false);
    const [addColMenuPos, setAddColMenuPos] = useState({ top: 0, left: 0 });
    const addColMenuRef = useRef(null);

    // ─── Renommage des colonnes en écriture libre directe (simple clic) ──────
    const [customColumnLabels, setCustomColumnLabels] = useState(() => {
        try {
            const saved = localStorage.getItem('crm_custom_column_labels');
            return saved ? JSON.parse(saved) : {};
        } catch {
            return {};
        }
    });
    const [editingHeaderKey, setEditingHeaderKey] = useState(null);
    const [editingHeaderLabel, setEditingHeaderLabel] = useState('');
    const headerInputRef = useRef(null);

    // Focus automatique lors de l'édition du nom de colonne
    useEffect(() => {
        if (editingHeaderKey && headerInputRef.current) {
            headerInputRef.current.focus();
            headerInputRef.current.select();
        }
    }, [editingHeaderKey]);

    // Sauvegarder le nouveau nom d'une colonne
    async function saveHeaderLabel(colKey, newTitle) {
        const trimmed = (newTitle || '').trim();
        setEditingHeaderKey(null);
        if (!trimmed) return;

        // 1. Sauvegarder dans customColumnLabels (localStorage pour toutes les colonnes)
        setCustomColumnLabels((prev) => {
            const next = { ...prev, [colKey]: trimmed };
            try {
                localStorage.setItem('crm_custom_column_labels', JSON.stringify(next));
            } catch (e) {
                console.error('Erreur sauvegarde custom labels:', e);
            }
            return next;
        });

        // 2. Si c'est une colonne personnalisée Firestore, mettre à jour le document Firestore
        const customCol = customColumns.find((c) => c.id === colKey);
        if (customCol) {
            const updated = customColumns.map((c) => (c.id === colKey ? { ...c, label: trimmed } : c));
            setCustomColumns(updated);
            try {
                await saveCustomColumns(updated);
            } catch (err) {
                console.error('Erreur mise à jour label colonne Firestore:', err);
            }
        }
    }

    // Réinitialiser les noms personnalisés des colonnes standard
    function resetStandardColumnLabels() {
        setCustomColumnLabels({});
        try {
            localStorage.removeItem('crm_custom_column_labels');
        } catch (e) { }
    }

    // ─── Ordre des colonnes (Interchangeables) ────────────────────────────────
    const [columnOrder, setColumnOrder] = useState(() => {
        try {
            const saved = localStorage.getItem('crm_column_order');
            return saved ? JSON.parse(saved) : null;
        } catch {
            return null;
        }
    });

    // Drag and Drop state
    const [draggedColKey, setDraggedColKey] = useState(null);
    const [dropTargetKey, setDropTargetKey] = useState(null);
    const [dropSide, setDropSide] = useState(null); // 'left' | 'right'

    // Sauvegarde de l'ordre des colonnes
    function saveOrder(newOrder) {
        setColumnOrder(newOrder);
        try {
            if (newOrder) {
                localStorage.setItem('crm_column_order', JSON.stringify(newOrder));
            } else {
                localStorage.removeItem('crm_column_order');
            }
        } catch (e) {
            console.error('Erreur sauvegarde ordre colonnes:', e);
        }
    }

    // Liste complète et unifiée des clés de colonnes effectives
    const effectiveColumnOrder = useMemo(() => {
        const customKeys = customColumns.map((c) => c.id);
        const allKnownKeys = [...DEFAULT_COLUMN_KEYS, ...customKeys];

        if (!columnOrder || !Array.isArray(columnOrder)) {
            // Ordre par défaut : colonnes standard + colonnes personnalisées avant notes
            const defaultOrder = [...DEFAULT_COLUMN_KEYS];
            const notesIdx = defaultOrder.indexOf('notes');
            if (notesIdx !== -1) {
                defaultOrder.splice(notesIdx, 0, ...customKeys);
            } else {
                defaultOrder.push(...customKeys);
            }
            return defaultOrder;
        }

        // Filtre les clés existantes
        const validSaved = columnOrder.filter((k) => allKnownKeys.includes(k));
        // Ajoute toute clé manquante non encore présente dans validSaved
        const missing = allKnownKeys.filter((k) => !validSaved.includes(k));
        return [...validSaved, ...missing];
    }, [columnOrder, customColumns]);

    // Dictionnaire des définitions de colonnes
    const columnDefinitions = useMemo(() => {
        const defs = {};
        STANDARD_COLUMNS.forEach((col) => {
            defs[col.key] = {
                ...col,
                label: customColumnLabels[col.key] || col.label,
                originalLabel: col.label,
                isStandard: true,
                isCustom: false,
            };
        });
        customColumns.forEach((col) => {
            defs[col.id] = {
                key: col.id,
                label: customColumnLabels[col.id] || col.label,
                originalLabel: col.label,
                type: col.type || (col.options?.length > 0 ? 'select' : 'text'),
                minWidth: col.minWidth || 130,
                isStandard: false,
                isCustom: true,
                rawCol: col,
            };
        });
        return defs;
    }, [customColumns, customColumnLabels]);

    // Colonnes visibles ordonnées
    const visibleColumns = useMemo(() => {
        return effectiveColumnOrder
            .filter((key) => {
                if (key === 'nom') return true; // Le nom reste toujours affiché
                return !hiddenStandardCols.includes(key);
            })
            .map((key) => columnDefinitions[key])
            .filter(Boolean);
    }, [effectiveColumnOrder, hiddenStandardCols, columnDefinitions]);

    // Fonction de déplacement / échange de colonnes
    function moveColumn(fromKey, toKey, targetSide = 'left') {
        if (!fromKey || !toKey || fromKey === toKey) return;
        const current = [...effectiveColumnOrder];
        const fromIdx = current.indexOf(fromKey);
        if (fromIdx === -1) return;

        current.splice(fromIdx, 1);
        const targetIdx = current.indexOf(toKey);
        if (targetIdx === -1) return;

        const insertIdx = targetSide === 'right' ? targetIdx + 1 : targetIdx;
        current.splice(insertIdx, 0, fromKey);
        saveOrder(current);
    }

    // Déplacement rapide via flèches ◀ et ▶
    function swapColumn(colKey, direction) {
        const visibleIdx = visibleColumns.findIndex((c) => c.key === colKey);
        if (visibleIdx === -1) return;

        if (direction === 'left' && visibleIdx > 0) {
            const prevCol = visibleColumns[visibleIdx - 1];
            moveColumn(colKey, prevCol.key, 'left');
        } else if (direction === 'right' && visibleIdx < visibleColumns.length - 1) {
            const nextCol = visibleColumns[visibleIdx + 1];
            moveColumn(colKey, nextCol.key, 'right');
        }
    }

    // Création ultra-simple d'une colonne de texte libre avec saisie directe du nom
    async function handleCreateNewTextColumn() {
        const newId = `col_${Date.now()}`;
        const newLabel = 'Nouvelle colonne';
        const newCol = {
            id: newId,
            label: newLabel,
            type: 'text',
            options: [],
        };

        const updated = [...customColumns, newCol];
        setCustomColumns(updated);

        // Ajout dans l'ordre des colonnes juste avant les notes ou à la fin
        const currentOrder = effectiveColumnOrder ? [...effectiveColumnOrder] : [...DEFAULT_COLUMN_KEYS];
        const notesIdx = currentOrder.indexOf('notes');
        if (notesIdx !== -1) {
            currentOrder.splice(notesIdx, 0, newId);
        } else {
            currentOrder.push(newId);
        }
        saveOrder(currentOrder);

        // Active immédiatement la saisie directe dans l'en-tête
        setEditingHeaderKey(newId);
        setEditingHeaderLabel(newLabel);

        try {
            await saveCustomColumns(updated);
        } catch (err) {
            console.error('Erreur sauvegarde nouvelle colonne:', err);
            onReload();
        }
    }

    // Gestion du masquage et de la restauration de colonnes
    function hideStandardCol(colKey) {
        setHiddenStandardCols((prev) => {
            const next = prev.includes(colKey) ? prev : [...prev, colKey];
            try {
                localStorage.setItem('crm_hidden_standard_cols', JSON.stringify(next));
            } catch (e) { }
            return next;
        });
        setColumnOrder((prev) => {
            if (!prev) return null;
            const next = prev.filter((k) => k !== colKey);
            saveOrder(next);
            return next;
        });
    }

    function restoreStandardCol(colKey) {
        setHiddenStandardCols((prev) => {
            const next = prev.filter((k) => k !== colKey);
            try {
                localStorage.setItem('crm_hidden_standard_cols', JSON.stringify(next));
            } catch (e) { }
            return next;
        });
        setColumnOrder((prev) => {
            const base = prev || DEFAULT_COLUMN_KEYS;
            if (base.includes(colKey)) return base;
            const next = [...base, colKey];
            saveOrder(next);
            return next;
        });
    }

    // ─── Édition inline des cellules ─────────────────────────────────────────
    const [editingCell, setEditingCell] = useState(null); // { clientId, field }
    const [editValue, setEditValue] = useState('');
    const inputRef = useRef(null);

    // ─── Ligne d'ajout rapide en bas ─────────────────────────────────────────
    const [newRowNom, setNewRowNom] = useState('');
    const [isCreatingBottomRow, setIsCreatingBottomRow] = useState(false);
    const newRowInputRef = useRef(null);

    // Focus automatique pour édition inline de cellules
    useEffect(() => {
        if (editingCell && inputRef.current) {
            inputRef.current.focus();
            if (typeof inputRef.current.select === 'function') {
                inputRef.current.select();
            }
        }
    }, [editingCell]);

    // Fermer les popovers et menus au clic extérieur, touche Echap ou scroll
    useEffect(() => {
        if (!activeDropdown && !showAddColMenu) return;

        function handleClickOutside(e) {
            if (popoverRef.current && !popoverRef.current.contains(e.target)) {
                setActiveDropdown(null);
            }
            if (addColMenuRef.current && !addColMenuRef.current.contains(e.target)) {
                setShowAddColMenu(false);
            }
        }

        function handleScroll() {
            if (activeDropdown) setActiveDropdown(null);
            if (showAddColMenu) setShowAddColMenu(false);
        }

        function handleEscape(e) {
            if (e.key === 'Escape') {
                setActiveDropdown(null);
                setShowAddColMenu(false);
            }
        }

        document.addEventListener('mousedown', handleClickOutside);
        window.addEventListener('scroll', handleScroll, true);
        window.addEventListener('keydown', handleEscape);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            window.removeEventListener('scroll', handleScroll, true);
            window.removeEventListener('keydown', handleEscape);
        };
    }, [activeDropdown, showAddColMenu]);

    // Raccourci clavier Delete pour supprimer les lignes sélectionnées
    useEffect(() => {
        function handleKeyDown(e) {
            if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size > 0 && !editingCell && !editingHeaderKey) {
                const tag = document.activeElement?.tagName;
                if (tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA') {
                    handleBulkDelete();
                }
            }
        }
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedIds, editingCell, editingHeaderKey]);

    // ─── Compteurs de segments ───────────────────────────────────────────────
    const counts = useMemo(() => {
        let prospect = 0;
        let client_actif = 0;
        let client_inactif = 0;

        clients.forEach((c) => {
            const st = c.statutGlobal || 'client_actif';
            if (st === 'prospect') prospect++;
            else if (st === 'client_inactif') client_inactif++;
            else client_actif++;
        });

        return {
            tous: clients.length,
            prospect,
            client_actif,
            client_inactif,
        };
    }, [clients]);

    // ─── Filtrage ────────────────────────────────────────────────────
    const filteredClients = useMemo(() => {
        return clients.filter((c) => {
            const statut = c.statutGlobal || 'client_actif';

            if (segmentFiltre !== 'tous' && statut !== segmentFiltre) return false;

            if (catFiltreId) {
                if (catFiltreId === '__none__' && c.categorieId) return false;
                if (catFiltreId !== '__none__' && c.categorieId !== catFiltreId) return false;
            }

            if (quiGereFiltre && (c.quiGere || '').toLowerCase() !== quiGereFiltre.toLowerCase()) {
                return false;
            }

            if (search.trim()) {
                const q = search.trim().toLowerCase();
                const matchNom = (c.nom || '').toLowerCase().includes(q);
                const matchContact = `${c.contactPrenom || ''} ${c.contactNom || ''}`.toLowerCase().includes(q);
                const matchTel = (c.telephone || '').toLowerCase().includes(q);
                const matchEmail = (c.email || '').toLowerCase().includes(q);
                const matchUrl = (c.siteUrl || '').toLowerCase().includes(q);
                const matchNotes = (c.notes || '').toLowerCase().includes(q);
                const matchAction = (c.prochaineAction || '').toLowerCase().includes(q);
                const matchRdv = (c.prochainRdvDate || '').toLowerCase().includes(q);
                if (!matchNom && !matchContact && !matchTel && !matchEmail && !matchUrl && !matchNotes && !matchAction && !matchRdv) {
                    return false;
                }
            }

            return true;
        });
    }, [clients, segmentFiltre, catFiltreId, quiGereFiltre, search]);

    // ─── Tri ─────────────────────────────────────────────────────────────────
    const sortedClients = useMemo(() => {
        return [...filteredClients].sort((a, b) => {
            let aVal = a[sortField] || '';
            let bVal = b[sortField] || '';

            if (sortField === 'contact') {
                aVal = `${a.contactNom || ''} ${a.contactPrenom || ''}`;
                bVal = `${b.contactNom || ''} ${b.contactPrenom || ''}`;
            } else if (sortField.startsWith('col_')) {
                aVal = (a.customFields && a.customFields[sortField]) || '';
                bVal = (b.customFields && b.customFields[sortField]) || '';
            }

            if (typeof aVal === 'string') {
                const cmp = aVal.localeCompare(bVal, 'fr', { numeric: true });
                return sortDirection === 'asc' ? cmp : -cmp;
            }
            return sortDirection === 'asc' ? (aVal > bVal ? 1 : -1) : (aVal < bVal ? 1 : -1);
        });
    }, [filteredClients, sortField, sortDirection]);

    function handleHeaderSort(field) {
        if (sortField === field) {
            setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortField(field);
            setSortDirection('asc');
        }
    }

    // ─── Sauvegarde optimiste champ inline standard ──────────────────────────
    async function saveInlineField(clientId, field, value) {
        setEditingCell(null);

        setClients((prev) =>
            prev.map((c) => {
                if (c.id !== clientId) return c;
                const updated = { ...c, [field]: value };
                if (field === 'abonnementMensuelManuel' || field === 'mrr' || field === 'abonnementMensuel') {
                    const num = parseFloat(String(value).replace(',', '.').replace(/[^0-9.-]+/g, '')) || 0;
                    updated.abonnementMensuel = num;
                    updated.abonnementMensuelManuel = num;
                    updated.mrr = num;
                }
                return updated;
            })
        );

        try {
            const updates = {
                [field]: value,
                updatedAt: serverTimestamp(),
            };
            if (field === 'abonnementMensuelManuel' || field === 'mrr' || field === 'abonnementMensuel') {
                const num = parseFloat(String(value).replace(',', '.').replace(/[^0-9.-]+/g, '')) || 0;
                updates.abonnementMensuel = num;
                updates.abonnementMensuelManuel = num;
                updates.mrr = num;
            }
            await updateDoc(doc(db, 'clients', clientId), updates);
        } catch (err) {
            console.error(`Erreur mise à jour ${field}:`, err);
            onReload();
        }
    }

    // ─── Sauvegarde optimiste champ personnalisé (texte, date, number, statut) ───
    async function saveCustomFieldValue(clientId, colKey, value) {
        setEditingCell(null);
        setActiveDropdown(null);

        setClients((prev) =>
            prev.map((c) => {
                if (c.id !== clientId) return c;
                return {
                    ...c,
                    customFields: {
                        ...(c.customFields || {}),
                        [colKey]: value,
                    },
                };
            })
        );

        try {
            await updateDoc(doc(db, 'clients', clientId), {
                [`customFields.${colKey}`]: value !== undefined ? value : null,
                updatedAt: serverTimestamp(),
            });
        } catch (err) {
            console.error(`Erreur mise à jour champ personnalisé ${colKey}:`, err);
            onReload();
        }
    }

    // ─── Suppression d'une colonne personnalisée ─────────────────────────────
    async function handleDeleteColumnDirect(colId, colLabel, e) {
        if (e) {
            e.stopPropagation();
            e.preventDefault();
        }

        const updated = customColumns.filter((c) => c.id !== colId);
        setCustomColumns(updated);

        // Retirer de columnOrder également
        setColumnOrder((prev) => {
            const base = prev || effectiveColumnOrder;
            const next = base.filter((k) => k !== colId);
            saveOrder(next);
            return next;
        });

        // Nettoyer le label personnalisé
        setCustomColumnLabels((prev) => {
            if (!prev[colId]) return prev;
            const next = { ...prev };
            delete next[colId];
            try {
                localStorage.setItem('crm_custom_column_labels', JSON.stringify(next));
            } catch (err) { }
            return next;
        });

        // Nettoyer aussi des colonnes masquées si présent
        setHiddenStandardCols((prev) => {
            if (!prev.includes(colId)) return prev;
            const next = prev.filter((k) => k !== colId);
            try {
                localStorage.setItem('crm_hidden_standard_cols', JSON.stringify(next));
            } catch (e) { }
            return next;
        });

        try {
            await saveCustomColumns(updated);
        } catch (err) {
            console.error('Erreur suppression colonne:', err);
        }
    }

    // ─── Bouton de suppression de colonne en 2 étapes cliquables ─────────────
    function HeaderDeleteBtn({ colKey, label, isCustom = false }) {
        const [confirming, setConfirming] = useState(false);
        const timerRef = useRef(null);

        useEffect(() => {
            if (confirming) {
                timerRef.current = setTimeout(() => {
                    setConfirming(false);
                }, 4000);
            }
            return () => {
                if (timerRef.current) clearTimeout(timerRef.current);
            };
        }, [confirming]);

        const handleClick = (e) => {
            e.stopPropagation();
            e.preventDefault();

            if (!confirming) {
                setConfirming(true);
                return;
            }

            // Étape 2 : L'utilisateur a cliqué une seconde fois pour confirmer
            setConfirming(false);
            if (isCustom) {
                handleDeleteColumnDirect(colKey, label, e);
            } else {
                hideStandardCol(colKey);
            }
        };

        return (
            <button
                type="button"
                draggable={false}
                onDragStart={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                }}
                onMouseDown={(e) => {
                    e.stopPropagation();
                }}
                onPointerDown={(e) => {
                    e.stopPropagation();
                }}
                onClick={handleClick}
                className={`crm-col-del-btn ${confirming ? 'crm-col-del-btn--confirming' : ''}`}
                title={confirming ? 'Cliquer à nouveau pour confirmer la suppression' : (isCustom ? `Supprimer la colonne "${label}"` : `Masquer la colonne "${label}"`)}
            >
                {confirming ? 'Supprimer ?' : '✕'}
            </button>
        );
    }

    // Nombre total de colonnes (index + colonnes visibles + bouton + + actions)
    const totalCols = 1 + visibleColumns.length + 1 + 1;

    // ─── Sélection ───────────────────────────────────────────────────────────
    function toggleSelectAll() {
        if (selectedIds.size === sortedClients.length && sortedClients.length > 0) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(sortedClients.map((c) => c.id)));
        }
    }

    function toggleSelectOne(id) {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }

    // ─── Suppression d'une ligne ─────────────────────────────────────────────
    async function handleDeleteSingle(clientId, clientNom, e) {
        if (e) e.stopPropagation();
        if (!window.confirm(`Supprimer définitivement "${clientNom || 'Sans nom'}" ?`)) return;

        setClients((prev) => prev.filter((c) => c.id !== clientId));
        setSelectedIds((prev) => {
            const next = new Set(prev);
            next.delete(clientId);
            return next;
        });

        try {
            await deleteDoc(doc(db, 'clients', clientId));
        } catch (err) {
            console.error('Erreur suppression client:', err);
            onReload();
        }
    }

    // ─── Actions groupées ────────────────────────────────────────────────────
    async function handleBulkDelete() {
        const ids = Array.from(selectedIds);
        if (ids.length === 0) return;
        if (!window.confirm(`Supprimer définitivement les ${ids.length} contacts sélectionnés ?`)) return;

        setClients((prev) => prev.filter((c) => !selectedIds.has(c.id)));
        setSelectedIds(new Set());

        try {
            await Promise.all(ids.map((id) => deleteDoc(doc(db, 'clients', id))));
        } catch (err) {
            console.error('Erreur suppression groupée:', err);
            onReload();
        }
    }

    async function handleBulkSetStatutGlobal(statut) {
        const ids = Array.from(selectedIds);
        if (ids.length === 0) return;

        setClients((prev) =>
            prev.map((c) => (selectedIds.has(c.id) ? { ...c, statutGlobal: statut } : c))
        );

        try {
            await Promise.all(
                ids.map((id) =>
                    updateDoc(doc(db, 'clients', id), {
                        statutGlobal: statut,
                        updatedAt: serverTimestamp(),
                    })
                )
            );
        } catch (err) {
            console.error('Erreur statut groupé:', err);
            onReload();
        }
    }

    async function handleBulkSetQuiGere(quiGere) {
        const ids = Array.from(selectedIds);
        if (ids.length === 0) return;

        setClients((prev) =>
            prev.map((c) => (selectedIds.has(c.id) ? { ...c, quiGere } : c))
        );

        try {
            await Promise.all(
                ids.map((id) =>
                    updateDoc(doc(db, 'clients', id), {
                        quiGere,
                        updatedAt: serverTimestamp(),
                    })
                )
            );
        } catch (err) {
            console.error('Erreur qui gère groupé:', err);
            onReload();
        }
    }

    async function handleBulkSetCategorie(catId) {
        const ids = Array.from(selectedIds);
        if (ids.length === 0) return;

        const catObj = categories.find((c) => c.id === catId);
        const catNom = catObj ? catObj.nom : null;

        setClients((prev) =>
            prev.map((c) =>
                selectedIds.has(c.id)
                    ? { ...c, categorieId: catId || null, categorieNom: catNom }
                    : c
            )
        );

        try {
            await Promise.all(
                ids.map((id) =>
                    updateDoc(doc(db, 'clients', id), {
                        categorieId: catId || null,
                        categorieNom: catNom,
                        updatedAt: serverTimestamp(),
                    })
                )
            );
        } catch (err) {
            console.error('Erreur catégorie groupée:', err);
            onReload();
        }
    }

    // ─── Ajout d'une ligne vide en haut ──────────────────────────────────────
    async function createEmptyRow(nomInitial = '') {
        const defaultStatut = segmentFiltre === 'prospect' ? 'prospect' : (segmentFiltre === 'client_inactif' ? 'client_inactif' : 'client_actif');
        const tempId = `tmp_${Date.now()}`;

        const newEntry = {
            id: tempId,
            nom: nomInitial || '',
            contactPrenom: '',
            contactNom: '',
            telephone: '',
            email: '',
            quiGere: '',
            statutGlobal: defaultStatut,
            categorieId: catFiltreId && catFiltreId !== '__none__' ? catFiltreId : null,
            siteUrl: '',
            notes: '',
            prochaineAction: '',
            dernierContactDate: '',
            prochainRdvDate: '',
            prochainRdvHeure: '',
            prochainRdvFormat: '',
            customFields: {},
            totalFacture: 0,
            totalEncaisse: 0,
            totalDepenses: 0,
            margeNette: 0,
            pourcentageMarge: 0,
        };

        setClients((prev) => [newEntry, ...prev]);

        try {
            const ref = await addDoc(collection(db, 'clients'), {
                nom: nomInitial || '',
                contactPrenom: '',
                contactNom: '',
                telephone: '',
                email: '',
                quiGere: '',
                statutGlobal: newEntry.statutGlobal,
                categorieId: newEntry.categorieId,
                siteUrl: '',
                notes: '',
                prochaineAction: '',
                dernierContactDate: '',
                customFields: {},
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });
            setClients((prev) => prev.map((c) => (c.id === tempId ? { ...c, id: ref.id } : c)));
            setEditingCell({ clientId: ref.id, field: 'nom' });
            setEditValue(nomInitial || '');
        } catch (err) {
            console.error('Erreur création ligne:', err);
            onReload();
        }
    }

    // ─── Ajout rapide en bas du tableau ──────────────────────────────────────
    async function handleCommitBottomRow() {
        const nom = newRowNom.trim();
        setIsCreatingBottomRow(false);
        setNewRowNom('');
        if (!nom) return;

        const defaultStatut = segmentFiltre === 'prospect' ? 'prospect' : (segmentFiltre === 'client_inactif' ? 'client_inactif' : 'client_actif');
        const tempId = `tmp_${Date.now()}`;

        const newEntry = {
            id: tempId,
            nom,
            contactPrenom: '',
            contactNom: '',
            telephone: '',
            email: '',
            quiGere: '',
            statutGlobal: defaultStatut,
            categorieId: catFiltreId && catFiltreId !== '__none__' ? catFiltreId : null,
            siteUrl: '',
            notes: '',
            prochaineAction: '',
            dernierContactDate: '',
            prochainRdvDate: '',
            prochainRdvHeure: '',
            prochainRdvFormat: '',
            customFields: {},
            totalFacture: 0,
            totalEncaisse: 0,
            totalDepenses: 0,
            margeNette: 0,
            pourcentageMarge: 0,
        };

        setClients((prev) => [...prev, newEntry]);

        try {
            const ref = await addDoc(collection(db, 'clients'), {
                nom,
                contactPrenom: '',
                contactNom: '',
                telephone: '',
                email: '',
                quiGere: '',
                statutGlobal: newEntry.statutGlobal,
                categorieId: newEntry.categorieId,
                siteUrl: '',
                notes: '',
                prochaineAction: '',
                dernierContactDate: '',
                customFields: {},
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });
            setClients((prev) => prev.map((c) => (c.id === tempId ? { ...c, id: ref.id } : c)));
        } catch (err) {
            console.error('Erreur création ligne basse:', err);
            onReload();
        }
    }

    const catMap = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c])), [categories]);

    // Liste unifiée des gestionnaires (priorité à la configuration personnalisée de l'équipe)
    const effectiveGestionnaires = useMemo(() => {
        if (Array.isArray(gestionnaires) && gestionnaires.length > 0) {
            return gestionnaires;
        }
        const set = new Set(['Antoine', 'Thomas']);
        associes.forEach((a) => {
            if (a.actif !== false) {
                const name = `${a.prenom || ''} ${a.nom || ''}`.trim();
                if (name) set.add(name);
            }
        });
        return Array.from(set);
    }, [gestionnaires, associes]);

    // ─── Rendu dynamique des cellules de chaque ligne ────────────────────────
    function renderCell(col, client) {
        const key = col.key;
        const cat = catMap[client.categorieId];
        const globalStatut = STATUTS_GLOBAUX.find((s) => s.id === (client.statutGlobal || 'client_actif')) || STATUTS_GLOBAUX[1];

        // 1. Nom / Établissement
        if (key === 'nom') {
            return (
                <td key={key} style={{ fontWeight: 600 }}>
                    {editingCell?.clientId === client.id && editingCell?.field === 'nom' ? (
                        <input
                            ref={inputRef}
                            type="text"
                            className="crm-grid-input"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={() => saveInlineField(client.id, 'nom', editValue.trim())}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') saveInlineField(client.id, 'nom', editValue.trim());
                                if (e.key === 'Escape') setEditingCell(null);
                            }}
                        />
                    ) : (
                        <div
                            className="crm-grid-cell"
                            onClick={() => {
                                setEditingCell({ clientId: client.id, field: 'nom' });
                                setEditValue(client.nom || '');
                            }}
                            title="Cliquer pour éditer"
                        >
                            {client.nom || <span style={{ color: 'var(--text-light)' }}>Sans nom</span>}
                        </div>
                    )}
                </td>
            );
        }

        // 2. Contact
        if (key === 'contact') {
            return (
                <td key={key}>
                    {editingCell?.clientId === client.id && editingCell?.field === 'contact' ? (
                        <input
                            ref={inputRef}
                            type="text"
                            className="crm-grid-input"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={() => {
                                const parts = editValue.trim().split(' ');
                                const prenom = parts[0] || '';
                                const nom = parts.slice(1).join(' ') || '';
                                saveInlineField(client.id, 'contactPrenom', prenom);
                                saveInlineField(client.id, 'contactNom', nom);
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    const parts = editValue.trim().split(' ');
                                    const prenom = parts[0] || '';
                                    const nom = parts.slice(1).join(' ') || '';
                                    saveInlineField(client.id, 'contactPrenom', prenom);
                                    saveInlineField(client.id, 'contactNom', nom);
                                }
                                if (e.key === 'Escape') setEditingCell(null);
                            }}
                        />
                    ) : (
                        <div
                            className="crm-grid-cell"
                            onClick={() => {
                                setEditingCell({ clientId: client.id, field: 'contact' });
                                setEditValue(`${client.contactPrenom || ''} ${client.contactNom || ''}`.trim());
                            }}
                            title="Cliquer pour éditer"
                        >
                            {`${client.contactPrenom || ''} ${client.contactNom || ''}`.trim() || (
                                <span style={{ color: 'var(--text-light)' }}>—</span>
                            )}
                        </div>
                    )}
                </td>
            );
        }

        // 3. Téléphone
        if (key === 'telephone') {
            return (
                <td key={key}>
                    {editingCell?.clientId === client.id && editingCell?.field === 'telephone' ? (
                        <input
                            ref={inputRef}
                            type="text"
                            className="crm-grid-input"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={() => saveInlineField(client.id, 'telephone', editValue.trim())}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') saveInlineField(client.id, 'telephone', editValue.trim());
                                if (e.key === 'Escape') setEditingCell(null);
                            }}
                        />
                    ) : (
                        <div
                            className="crm-grid-cell"
                            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                            onClick={() => {
                                setEditingCell({ clientId: client.id, field: 'telephone' });
                                setEditValue(client.telephone || '');
                            }}
                            title="Cliquer pour éditer"
                        >
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {client.telephone || <span style={{ color: 'var(--text-light)' }}>—</span>}
                            </span>
                            {client.telephone && (
                                <a
                                    href={`tel:${client.telephone}`}
                                    onClick={(e) => e.stopPropagation()}
                                    style={{ color: 'var(--accent)', fontSize: 10, marginLeft: 4, textDecoration: 'none', background: 'var(--bg3)', padding: '1px 4px', borderRadius: 3 }}
                                    title="Appeler"
                                >
                                    [tel]
                                </a>
                            )}
                        </div>
                    )}
                </td>
            );
        }

        // 4. Email
        if (key === 'email') {
            return (
                <td key={key}>
                    {editingCell?.clientId === client.id && editingCell?.field === 'email' ? (
                        <input
                            ref={inputRef}
                            type="email"
                            className="crm-grid-input"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={() => saveInlineField(client.id, 'email', editValue.trim())}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') saveInlineField(client.id, 'email', editValue.trim());
                                if (e.key === 'Escape') setEditingCell(null);
                            }}
                        />
                    ) : (
                        <div
                            className="crm-grid-cell"
                            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                            onClick={() => {
                                setEditingCell({ clientId: client.id, field: 'email' });
                                setEditValue(client.email || '');
                            }}
                            title={client.email || 'Cliquer pour éditer'}
                        >
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {client.email || <span style={{ color: 'var(--text-light)' }}>—</span>}
                            </span>
                            {client.email && (
                                <a
                                    href={`mailto:${client.email}`}
                                    onClick={(e) => e.stopPropagation()}
                                    style={{ color: 'var(--accent)', fontSize: 10, marginLeft: 4, textDecoration: 'none', background: 'var(--bg3)', padding: '1px 4px', borderRadius: 3 }}
                                    title="Écrire un email"
                                >
                                    [@]
                                </a>
                            )}
                        </div>
                    )}
                </td>
            );
        }

        // 5. Site Web
        if (key === 'siteUrl') {
            return (
                <td key={key}>
                    {editingCell?.clientId === client.id && editingCell?.field === 'siteUrl' ? (
                        <input
                            ref={inputRef}
                            type="text"
                            className="crm-grid-input"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={() => saveInlineField(client.id, 'siteUrl', editValue.trim())}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') saveInlineField(client.id, 'siteUrl', editValue.trim());
                                if (e.key === 'Escape') setEditingCell(null);
                            }}
                        />
                    ) : (
                        <div
                            className="crm-grid-cell"
                            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                            onClick={() => {
                                setEditingCell({ clientId: client.id, field: 'siteUrl' });
                                setEditValue(client.siteUrl || '');
                            }}
                            title={client.siteUrl || 'Cliquer pour éditer'}
                        >
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {client.siteUrl ? client.siteUrl.replace(/^https?:\/\//, '') : <span style={{ color: 'var(--text-light)' }}>—</span>}
                            </span>
                            {client.siteUrl && (
                                <a
                                    href={client.siteUrl.startsWith('http') ? client.siteUrl : `https://${client.siteUrl}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    style={{ color: 'var(--accent)', fontSize: 11, marginLeft: 4 }}
                                    title="Ouvrir le site"
                                >
                                    ↗
                                </a>
                            )}
                        </div>
                    )}
                </td>
            );
        }

        // 6. Qui gère
        if (key === 'quiGere') {
            return (
                <td key={key}>
                    <div className="crm-grid-cell" style={{ padding: '0 4px' }}>
                        <select
                            value={client.quiGere || ''}
                            onChange={(e) => saveInlineField(client.id, 'quiGere', e.target.value)}
                            style={{
                                width: '100%',
                                height: 26,
                                border: 'none',
                                background: 'transparent',
                                fontSize: 12,
                                color: client.quiGere ? 'var(--text)' : '#94a3b8',
                                cursor: 'pointer',
                                outline: 'none',
                            }}
                        >
                            <option value="">Non assigné</option>
                            {effectiveGestionnaires.map((m) => (
                                <option key={m} value={m}>{m}</option>
                            ))}
                        </select>
                    </div>
                </td>
            );
        }

        // 7. Statut global
        if (key === 'statutGlobal') {
            return (
                <td key={key}>
                    <div className="crm-grid-cell" style={{ padding: '0 4px' }}>
                        <select
                            value={client.statutGlobal || 'client_actif'}
                            onChange={(e) => saveInlineField(client.id, 'statutGlobal', e.target.value)}
                            style={{
                                width: '100%',
                                height: 24,
                                border: `1px solid ${globalStatut.border}`,
                                borderRadius: 4,
                                background: globalStatut.bg,
                                color: globalStatut.color,
                                fontSize: 11,
                                fontWeight: 600,
                                padding: '1px 6px',
                                cursor: 'pointer',
                                outline: 'none',
                            }}
                        >
                            {STATUTS_GLOBAUX.map((s) => (
                                <option key={s.id} value={s.id}>{s.label}</option>
                            ))}
                        </select>
                    </div>
                </td>
            );
        }

        // 8. Catégorie
        if (key === 'categorieId') {
            return (
                <td key={key}>
                    <div className="crm-grid-cell" style={{ padding: '0 4px' }}>
                        <select
                            value={client.categorieId || ''}
                            onChange={(e) => {
                                const val = e.target.value;
                                const catObj = categories.find((c) => c.id === val);
                                saveInlineField(client.id, 'categorieId', val || null);
                                saveInlineField(client.id, 'categorieNom', catObj?.nom || null);
                            }}
                            style={{
                                width: '100%',
                                height: 24,
                                border: cat ? `1px solid ${cat.couleur}` : '1px solid transparent',
                                borderRadius: 4,
                                background: cat ? `${cat.couleur}15` : 'transparent',
                                color: cat ? cat.couleur : '#94a3b8',
                                fontSize: 11,
                                fontWeight: cat ? 600 : 400,
                                padding: '1px 6px',
                                cursor: 'pointer',
                                outline: 'none',
                            }}
                        >
                            <option value="">Sans catégorie</option>
                            {categories.map((c) => (
                                <option key={c.id} value={c.id}>{c.nom}</option>
                            ))}
                        </select>
                    </div>
                </td>
            );
        }

        // 9. Dernier contact
        if (key === 'dernierContactDate') {
            return (
                <td key={key}>
                    {editingCell?.clientId === client.id && editingCell?.field === 'dernierContactDate' ? (
                        <DateInput
                            ref={inputRef}
                            className="crm-grid-input"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={() => saveInlineField(client.id, 'dernierContactDate', editValue)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') saveInlineField(client.id, 'dernierContactDate', editValue);
                                if (e.key === 'Escape') setEditingCell(null);
                            }}
                        />
                    ) : (
                        <div
                            className="crm-grid-cell"
                            onClick={() => {
                                setEditingCell({ clientId: client.id, field: 'dernierContactDate' });
                                setEditValue(client.dernierContactDate || '');
                            }}
                            title="Cliquer pour définir la date"
                        >
                            {client.dernierContactDate ? (
                                formatDate(client.dernierContactDate)
                            ) : (
                                <span style={{ color: 'var(--text-light)' }}>—</span>
                            )}
                        </div>
                    )}
                </td>
            );
        }

        // 9b. Prochain rendez-vous
        if (key === 'prochainRdvDate') {
            const hasRdv = Boolean(client.prochainRdvDate);
            return (
                <td key={key}>
                    <div
                        className="crm-grid-cell"
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', padding: '0 6px' }}
                    >
                        {hasRdv ? (
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedClientForRdv(client);
                                }}
                                title={`RDV prévu : ${formatDate(client.prochainRdvDate)}${client.prochainRdvHeure ? ' à ' + client.prochainRdvHeure : ''}${client.prochainRdvFormat ? ' (' + client.prochainRdvFormat + ')' : ''}. Cliquer pour voir / modifier.`}
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 5,
                                    padding: '2px 8px',
                                    borderRadius: 4,
                                    background: 'rgba(59, 130, 246, 0.12)',
                                    border: '1px solid rgba(59, 130, 246, 0.35)',
                                    color: 'var(--accent)',
                                    fontSize: 11,
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    maxWidth: '100%',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                }}
                            >
                                <span>{formatDate(client.prochainRdvDate)}</span>
                                {client.prochainRdvHeure && (
                                    <span style={{ opacity: 0.85, fontSize: 10, fontFamily: 'monospace' }}>
                                        {client.prochainRdvHeure}
                                    </span>
                                )}
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedClientForRdv(client);
                                }}
                                style={{
                                    background: 'transparent',
                                    border: '1px dashed var(--border)',
                                    color: 'var(--text-light)',
                                    padding: '2px 8px',
                                    borderRadius: 4,
                                    fontSize: 11,
                                    cursor: 'pointer',
                                }}
                                title="Planifier un rendez-vous"
                            >
                                + Planifier
                            </button>
                        )}
                    </div>
                </td>
            );
        }

        // 10. Prochaine action
        if (key === 'prochaineAction') {
            return (
                <td key={key}>
                    {editingCell?.clientId === client.id && editingCell?.field === 'prochaineAction' ? (
                        <input
                            ref={inputRef}
                            type="text"
                            className="crm-grid-input"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={() => saveInlineField(client.id, 'prochaineAction', editValue.trim())}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') saveInlineField(client.id, 'prochaineAction', editValue.trim());
                                if (e.key === 'Escape') setEditingCell(null);
                            }}
                        />
                    ) : (
                        <div
                            className="crm-grid-cell"
                            onClick={() => {
                                setEditingCell({ clientId: client.id, field: 'prochaineAction' });
                                setEditValue(client.prochaineAction || '');
                            }}
                            title={client.prochaineAction || 'Cliquer pour définir'}
                        >
                            {client.prochaineAction || <span style={{ color: 'var(--text-light)' }}>—</span>}
                        </div>
                    )}
                </td>
            );
        }

        // 11. MRR (€)
        if (key === 'mrr') {
            return (
                <td key={key} style={{ textAlign: 'right' }}>
                    {editingCell?.clientId === client.id && editingCell?.field === 'mrr' ? (
                        <input
                            ref={inputRef}
                            type="number"
                            step="any"
                            className="crm-grid-input"
                            style={{ textAlign: 'right' }}
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={() => saveInlineField(client.id, 'mrr', editValue)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') saveInlineField(client.id, 'mrr', editValue);
                                if (e.key === 'Escape') setEditingCell(null);
                            }}
                        />
                    ) : (
                        <div
                            className="crm-grid-cell"
                            style={{ justifyContent: 'flex-end', fontWeight: 600, color: (client.abonnementMensuel || client.mrr) > 0 ? 'var(--accent)' : '#94a3b8' }}
                            onClick={() => {
                                setEditingCell({ clientId: client.id, field: 'mrr' });
                                setEditValue(client.abonnementMensuel || client.mrr || '');
                            }}
                            title="Cliquer pour éditer le MRR"
                        >
                            {(client.abonnementMensuel || client.mrr) > 0 ? (
                                `${formatMontant(client.abonnementMensuel || client.mrr)} /m`
                            ) : (
                                <span style={{ color: 'var(--text-light)' }}>0,00 €</span>
                            )}
                        </div>
                    )}
                </td>
            );
        }

        // 12. Notes
        if (key === 'notes') {
            return (
                <td key={key}>
                    {editingCell?.clientId === client.id && editingCell?.field === 'notes' ? (
                        <input
                            ref={inputRef}
                            type="text"
                            className="crm-grid-input"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={() => saveInlineField(client.id, 'notes', editValue.trim())}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') saveInlineField(client.id, 'notes', editValue.trim());
                                if (e.key === 'Escape') setEditingCell(null);
                            }}
                        />
                    ) : (
                        <div
                            className="crm-grid-cell"
                            onClick={() => {
                                setEditingCell({ clientId: client.id, field: 'notes' });
                                setEditValue(client.notes || '');
                            }}
                            title={client.notes || 'Cliquer pour écrire une note'}
                        >
                            {client.notes || <span style={{ color: 'var(--text-light)' }}>—</span>}
                        </div>
                    )}
                </td>
            );
        }

        // 13. Colonnes personnalisées (texte libre ou statut)
        if (col.isCustom) {
            const colType = col.rawCol?.type || (col.rawCol?.options?.length > 0 ? 'select' : 'text');
            const currentVal = client.customFields?.[col.key];

            // A. Statut / Menu déroulant
            if (colType === 'select') {
                const selectedOpt = (col.rawCol?.options || []).find((opt) => opt.id === currentVal);
                const isOpen = activeDropdown?.clientId === client.id && activeDropdown?.colId === col.key;

                return (
                    <td key={col.key} className="crm-dropdown-container">
                        <div
                            className="crm-grid-cell"
                            style={{ padding: '0 4px', cursor: 'pointer' }}
                            onClick={(e) => {
                                e.stopPropagation();
                                if (isOpen) {
                                    setActiveDropdown(null);
                                } else {
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const spaceBelow = window.innerHeight - rect.bottom;
                                    const openUp = spaceBelow < 200 && rect.top > 200;
                                    setActiveDropdown({
                                        clientId: client.id,
                                        colId: col.key,
                                        top: openUp ? rect.top : rect.bottom + 2,
                                        left: Math.max(10, Math.min(rect.left, window.innerWidth - 180)),
                                        openUp,
                                        currentOptId: currentVal,
                                        colOptions: col.rawCol?.options || [],
                                    });
                                }
                            }}
                        >
                            <div
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    width: '100%',
                                    padding: '2px 8px',
                                    borderRadius: 4,
                                    fontSize: 11,
                                    fontWeight: 600,
                                    background: selectedOpt?.bg || 'var(--bg3)',
                                    color: selectedOpt?.color || 'var(--text-muted)',
                                    border: `1px solid ${selectedOpt?.border || 'var(--border)'}`,
                                }}
                            >
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {selectedOpt?.label || 'Non défini'}
                                </span>
                                <span style={{ fontSize: 9, opacity: 0.6, marginLeft: 4 }}>▼</span>
                            </div>
                        </div>
                    </td>
                );
            }

            // B. Texte libre (par défaut) - Écriture directe au clavier
            const isEditing = editingCell?.clientId === client.id && editingCell?.field === col.key;
            return (
                <td key={col.key}>
                    {isEditing ? (
                        <input
                            ref={inputRef}
                            type="text"
                            className="crm-grid-input"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={() => saveCustomFieldValue(client.id, col.key, editValue.trim())}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') saveCustomFieldValue(client.id, col.key, editValue.trim());
                                if (e.key === 'Escape') setEditingCell(null);
                            }}
                        />
                    ) : (
                        <div
                            className="crm-grid-cell"
                            onClick={() => {
                                setEditingCell({ clientId: client.id, field: col.key });
                                setEditValue(currentVal || '');
                            }}
                            title={currentVal || 'Cliquer pour éditer'}
                        >
                            {currentVal || <span style={{ color: 'var(--text-light)' }}>—</span>}
                        </div>
                    )}
                </td>
            );
        }

        return <td key={key} />;
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
            {/* ─── Barre d'actions & sous-onglets ClickUp ──────────────────────── */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                {/* Segments rapides */}
                <div style={{ display: 'flex', gap: 2, background: 'var(--bg3)', padding: 3, borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                    <button
                        type="button"
                        onClick={() => setSegmentFiltre('tous')}
                        className={`btn btn--sm ${segmentFiltre === 'tous' ? 'btn--primary' : 'btn--ghost'}`}
                        style={{ padding: '4px 12px', fontSize: 12, fontWeight: 500, borderRadius: 4 }}
                    >
                        Tous <span style={{ opacity: 0.75, marginLeft: 4 }}>({counts.tous})</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => setSegmentFiltre('prospect')}
                        className={`btn btn--sm ${segmentFiltre === 'prospect' ? 'btn--primary' : 'btn--ghost'}`}
                        style={{ padding: '4px 12px', fontSize: 12, fontWeight: 500, borderRadius: 4 }}
                    >
                        Prospects <span style={{ opacity: 0.75, marginLeft: 4 }}>({counts.prospect})</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => setSegmentFiltre('client_actif')}
                        className={`btn btn--sm ${segmentFiltre === 'client_actif' ? 'btn--primary' : 'btn--ghost'}`}
                        style={{ padding: '4px 12px', fontSize: 12, fontWeight: 500, borderRadius: 4 }}
                    >
                        Clients actifs <span style={{ opacity: 0.75, marginLeft: 4 }}>({counts.client_actif})</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => setSegmentFiltre('client_inactif')}
                        className={`btn btn--sm ${segmentFiltre === 'client_inactif' ? 'btn--primary' : 'btn--ghost'}`}
                        style={{ padding: '4px 12px', fontSize: 12, fontWeight: 500, borderRadius: 4 }}
                    >
                        Clients inactifs <span style={{ opacity: 0.75, marginLeft: 4 }}>({counts.client_inactif})</span>
                    </button>
                </div>

                {/* Boutons d'action principaux */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button
                        type="button"
                        className="btn btn--primary btn--sm"
                        onClick={() => createEmptyRow('')}
                        style={{ fontSize: 12, fontWeight: 600 }}
                    >
                        + Ajouter une ligne
                    </button>
                    <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        onClick={() => setShowQuickAvailModal(true)}
                        style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--accent)', fontWeight: 600 }}
                        title="Consulter les disponibilités en direct et bloquer un créneau pendant un appel"
                    >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                            <line x1="16" y1="2" x2="16" y2="6"></line>
                            <line x1="8" y1="2" x2="8" y2="6"></line>
                            <line x1="3" y1="10" x2="21" y2="10"></line>
                        </svg>
                        <span>Disponibilités d'appel</span>
                    </button>
                    <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        onClick={() => setShowGestionnairesModal(true)}
                        style={{ fontSize: 12 }}
                    >
                        Gestionnaires ({effectiveGestionnaires.length})
                    </button>
                    <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        onClick={() => setShowColModal(true)}
                        style={{ fontSize: 12 }}
                    >
                        Gérer les statuts ({customColumns.length})
                    </button>
                    {hiddenStandardCols.length > 0 && (
                        <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            onClick={(e) => {
                                const rect = e.currentTarget.getBoundingClientRect();
                                setAddColMenuPos({ top: rect.bottom + 4, left: rect.left });
                                setShowAddColMenu((prev) => !prev);
                            }}
                            style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}
                        >
                            Colonnes masquées ({hiddenStandardCols.length})
                        </button>
                    )}
                </div>
            </div>

            {/* ─── Barre de filtres & recherche rapide ─────────────────────────── */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                    type="text"
                    className="form-input"
                    placeholder="Recherche dans le tableau..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    style={{ maxWidth: 240, fontSize: 12, height: 30 }}
                />

                <select
                    className="form-select"
                    value={catFiltreId}
                    onChange={(e) => setCatFiltreId(e.target.value)}
                    style={{ maxWidth: 170, fontSize: 12, height: 30 }}
                >
                    <option value="">Toutes catégories</option>
                    <option value="__none__">Non catégorisé</option>
                    {categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.nom}</option>
                    ))}
                </select>

                <select
                    className="form-select"
                    value={quiGereFiltre}
                    onChange={(e) => setQuiGereFiltre(e.target.value)}
                    style={{ maxWidth: 170, fontSize: 12, height: 30 }}
                >
                    <option value="">Tous les gestionnaires</option>
                    {effectiveGestionnaires.map((m) => (
                        <option key={m} value={m}>{m}</option>
                    ))}
                </select>

                {(search || catFiltreId || quiGereFiltre) && (
                    <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => { setSearch(''); setCatFiltreId(''); setQuiGereFiltre(''); }}
                        style={{ fontSize: 11, height: 30 }}
                    >
                        Effacer filtres
                    </button>
                )}

                <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
                    {sortedClients.length} ligne{sortedClients.length > 1 ? 's' : ''}
                </div>
            </div>

            {/* ─── TABLEAU SPREADSHEET PLEINE PAGE AVEC RENOMMAGE AU CLIC & INTERCHANGEMENT ─── */}
            <div className="crm-table-scroll">
                <table className="crm-grid-table">
                    <thead>
                        <tr style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                            {/* Numéro de ligne + sélection */}
                            <th className="crm-row-number-col" style={{ width: 44, minWidth: 44, padding: '6px 0' }}>
                                <input
                                    type="checkbox"
                                    checked={selectedIds.size === sortedClients.length && sortedClients.length > 0}
                                    onChange={toggleSelectAll}
                                    style={{ cursor: 'pointer' }}
                                    title="Tout sélectionner"
                                />
                            </th>

                            {/* Colonnes ordonnées, renommables en un clic et interchangeables */}
                            {visibleColumns.map((col, idx) => {
                                const isDragging = draggedColKey === col.key;
                                const isDropTarget = dropTargetKey === col.key;
                                const dropClass = isDropTarget
                                    ? dropSide === 'left'
                                        ? 'crm-th-drop-left'
                                        : 'crm-th-drop-right'
                                    : '';
                                const isEditingHeader = editingHeaderKey === col.key;

                                return (
                                    <th
                                        key={col.key}
                                        draggable={!isEditingHeader}
                                        onDragStart={(e) => {
                                            if (isEditingHeader) return;
                                            setDraggedColKey(col.key);
                                            e.dataTransfer.setData('text/plain', col.key);
                                            e.dataTransfer.effectAllowed = 'move';
                                        }}
                                        onDragOver={(e) => {
                                            e.preventDefault();
                                            if (draggedColKey && draggedColKey !== col.key) {
                                                const rect = e.currentTarget.getBoundingClientRect();
                                                const side = (e.clientX - rect.left) < rect.width / 2 ? 'left' : 'right';
                                                setDropTargetKey(col.key);
                                                setDropSide(side);
                                            }
                                        }}
                                        onDragLeave={() => {
                                            if (dropTargetKey === col.key) {
                                                setDropTargetKey(null);
                                                setDropSide(null);
                                            }
                                        }}
                                        onDrop={(e) => {
                                            e.preventDefault();
                                            if (draggedColKey && draggedColKey !== col.key) {
                                                moveColumn(draggedColKey, col.key, dropSide || 'left');
                                            }
                                            setDraggedColKey(null);
                                            setDropTargetKey(null);
                                            setDropSide(null);
                                        }}
                                        onDragEnd={() => {
                                            setDraggedColKey(null);
                                            setDropTargetKey(null);
                                            setDropSide(null);
                                        }}
                                        className={`crm-th-draggable ${isDragging ? 'crm-th-dragging' : ''} ${dropClass}`}
                                        style={{
                                            minWidth: col.minWidth || 120,
                                            textAlign: col.align || 'left',
                                        }}
                                    >
                                        <div className="crm-th-content">
                                            {/* Titre : Édition libre directe d'un simple clic */}
                                            {isEditingHeader ? (
                                                <input
                                                    ref={headerInputRef}
                                                    type="text"
                                                    className="crm-header-rename-input"
                                                    value={editingHeaderLabel}
                                                    onChange={(e) => setEditingHeaderLabel(e.target.value)}
                                                    onBlur={() => saveHeaderLabel(col.key, editingHeaderLabel)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') saveHeaderLabel(col.key, editingHeaderLabel);
                                                        if (e.key === 'Escape') setEditingHeaderKey(null);
                                                    }}
                                                    onClick={(e) => e.stopPropagation()}
                                                />
                                            ) : (
                                                <div
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setEditingHeaderKey(col.key);
                                                        setEditingHeaderLabel(col.label);
                                                    }}
                                                    style={{
                                                        cursor: 'text',
                                                        flex: 1,
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        padding: '2px 0',
                                                    }}
                                                    title={`${col.label} • Cliquez pour modifier le nom • Glissez pour déplacer`}
                                                >
                                                    {col.label}
                                                </div>
                                            )}

                                            {/* Bouton Tri discret */}
                                            <span
                                                draggable={false}
                                                onMouseDown={(e) => {
                                                    e.stopPropagation();
                                                }}
                                                onPointerDown={(e) => {
                                                    e.stopPropagation();
                                                }}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleHeaderSort(col.key);
                                                }}
                                                style={{
                                                    cursor: 'pointer',
                                                    padding: '0 3px',
                                                    color: sortField === col.key ? 'var(--accent)' : 'var(--text-light)',
                                                    fontWeight: 700,
                                                    fontSize: 10,
                                                    userSelect: 'none',
                                                    flexShrink: 0,
                                                }}
                                                title="Cliquer pour trier"
                                            >
                                                {sortField === col.key ? (sortDirection === 'asc' ? '↑' : '↓') : '↕'}
                                            </span>

                                            {/* Actions : Flèches ◀ ▶ + suppression */}
                                            <div
                                                className="crm-th-actions"
                                                draggable={false}
                                                onDragStart={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                }}
                                                onMouseDown={(e) => {
                                                    e.stopPropagation();
                                                }}
                                                onPointerDown={(e) => {
                                                    e.stopPropagation();
                                                }}
                                            >
                                                {/* Bouton déplacer à gauche */}
                                                <button
                                                    type="button"
                                                    draggable={false}
                                                    className="crm-col-reorder-btn"
                                                    onDragStart={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                    }}
                                                    onMouseDown={(e) => {
                                                        e.stopPropagation();
                                                    }}
                                                    onPointerDown={(e) => {
                                                        e.stopPropagation();
                                                    }}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        swapColumn(col.key, 'left');
                                                    }}
                                                    disabled={idx === 0}
                                                    title="Déplacer vers la gauche"
                                                >
                                                    ◀
                                                </button>

                                                {/* Bouton déplacer à droite */}
                                                <button
                                                    type="button"
                                                    draggable={false}
                                                    className="crm-col-reorder-btn"
                                                    onDragStart={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                    }}
                                                    onMouseDown={(e) => {
                                                        e.stopPropagation();
                                                    }}
                                                    onPointerDown={(e) => {
                                                        e.stopPropagation();
                                                    }}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        swapColumn(col.key, 'right');
                                                    }}
                                                    disabled={idx === visibleColumns.length - 1}
                                                    title="Déplacer vers la droite"
                                                >
                                                    ▶
                                                </button>

                                                {/* Bouton supprimer la colonne */}
                                                {col.key !== 'nom' && (
                                                    <HeaderDeleteBtn
                                                        colKey={col.key}
                                                        label={col.label}
                                                        isCustom={col.isCustom}
                                                    />
                                                )}
                                            </div>
                                        </div>
                                    </th>
                                );
                            })}

                            {/* Bouton + dans l'en-tête pour ajouter ou gérer des colonnes */}
                            <th
                                onClick={(e) => {
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    setAddColMenuPos({ top: rect.bottom + 4, left: Math.max(10, rect.left - 140) });
                                    setShowAddColMenu((prev) => !prev);
                                }}
                                style={{ width: 36, minWidth: 36, cursor: 'pointer', textAlign: 'center', background: 'var(--bg3)', color: 'var(--accent)', fontSize: 16, fontWeight: 700 }}
                                title="Ajouter une colonne (texte ou statut)"
                            >
                                +
                            </th>

                            {/* Actions / Fiche */}
                            <th style={{ width: 80, minWidth: 80, textAlign: 'center' }}>
                                Actions
                            </th>
                        </tr>
                    </thead>

                    <tbody>
                        {sortedClients.map((client, index) => {
                            const isSelected = selectedIds.has(client.id);

                            return (
                                <tr
                                    key={client.id}
                                    className="crm-grid-row"
                                    style={{ background: isSelected ? 'rgba(37, 99, 235, 0.08)' : undefined }}
                                >
                                    {/* Numéro de ligne + Checkbox */}
                                    <td className="crm-row-number-col">
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
                                            <input
                                                type="checkbox"
                                                checked={isSelected}
                                                onChange={() => toggleSelectOne(client.id)}
                                                style={{ cursor: 'pointer', marginRight: 4 }}
                                            />
                                            <span style={{ fontSize: 11, color: '#94a3b8', minWidth: 14 }}>
                                                {index + 1}
                                            </span>
                                        </div>
                                    </td>

                                    {/* Rendu ordonné de chaque cellule */}
                                    {visibleColumns.map((col) => renderCell(col, client))}

                                    {/* Colonne d'alignement avec le bouton + de l'en-tête */}
                                    <td style={{ background: 'var(--bg2)' }} />

                                    {/* Actions : Fiche + Bouton Supprimer direct */}
                                    <td style={{ textAlign: 'center', padding: '0 4px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                                            <button
                                                type="button"
                                                className="btn btn--ghost btn--sm"
                                                onClick={() => navigate(`/clients/${client.id}`)}
                                                style={{ padding: '2px 6px', height: 24, fontSize: 11, fontWeight: 600 }}
                                                title="Ouvrir la fiche complète"
                                            >
                                                Fiche
                                            </button>
                                            <button
                                                type="button"
                                                className="btn btn--ghost btn--sm"
                                                onClick={(e) => handleDeleteSingle(client.id, client.nom, e)}
                                                style={{ padding: '2px 5px', height: 24, fontSize: 11, color: '#ef4444' }}
                                                title="Supprimer cette ligne"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}

                        {/* ─── LIGNE PERMANENTE D'AJOUT RAPIDE ─── */}
                        <tr className="crm-grid-new-row">
                            <td className="crm-row-number-col" style={{ color: 'var(--accent)', fontWeight: 700 }}>
                                +
                            </td>
                            <td colSpan={totalCols - 1} style={{ padding: 0 }}>
                                {isCreatingBottomRow ? (
                                    <div style={{ display: 'flex', alignItems: 'center', width: '100%', height: 34 }}>
                                        <input
                                            ref={newRowInputRef}
                                            type="text"
                                            className="crm-grid-input"
                                            placeholder="Tapez le nom de l'entreprise et appuyez sur Entrée..."
                                            value={newRowNom}
                                            onChange={(e) => setNewRowNom(e.target.value)}
                                            onBlur={handleCommitBottomRow}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') handleCommitBottomRow();
                                                if (e.key === 'Escape') {
                                                    setIsCreatingBottomRow(false);
                                                    setNewRowNom('');
                                                }
                                            }}
                                            autoFocus
                                        />
                                    </div>
                                ) : (
                                    <div
                                        className="crm-grid-cell"
                                        onClick={() => {
                                            setIsCreatingBottomRow(true);
                                            setTimeout(() => newRowInputRef.current?.focus(), 50);
                                        }}
                                        style={{ color: '#64748b', fontStyle: 'italic', gap: 6 }}
                                    >
                                        <span style={{ color: 'var(--accent)', fontWeight: 700 }}>+</span>
                                        <span>Ajouter une nouvelle ligne (cliquez ici ou appuyez sur Entrée)...</span>
                                    </div>
                                )}
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            {/* ─── BARRE D'ACTIONS GROUPÉES ÉLÉGANTE ET LISIBLE ────────────────── */}
            {selectedIds.size > 0 && (
                <div
                    style={{
                        position: 'fixed',
                        bottom: 24,
                        left: '50%',
                        transform: 'translateX(-50%)',
                        zIndex: 100,
                        background: '#0f172a',
                        color: '#ffffff',
                        padding: '8px 18px',
                        borderRadius: 10,
                        boxShadow: '0 12px 30px rgba(0, 0, 0, 0.35)',
                        border: '1px solid #334155',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        fontSize: 12,
                    }}
                >
                    <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ background: '#38bdf8', color: '#0f172a', borderRadius: 4, padding: '1px 6px', fontSize: 11, fontWeight: 700 }}>
                            {selectedIds.size}
                        </span>
                        <span>sélectionné{selectedIds.size > 1 ? 's' : ''}</span>
                    </div>

                    <div style={{ height: 16, width: 1, background: '#334155' }} />

                    {/* Statut global groupé */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ color: '#94a3b8', fontSize: 11 }}>Statut :</span>
                        <select
                            onChange={(e) => {
                                if (e.target.value) handleBulkSetStatutGlobal(e.target.value);
                            }}
                            defaultValue=""
                            style={{
                                height: 28,
                                minWidth: 120,
                                fontSize: 11,
                                background: '#1e293b',
                                color: '#f8fafc',
                                border: '1px solid #475569',
                                borderRadius: 6,
                                padding: '0 8px',
                                outline: 'none',
                                cursor: 'pointer',
                            }}
                        >
                            <option value="" disabled>Changer statut...</option>
                            {STATUTS_GLOBAUX.map((s) => (
                                <option key={s.id} value={s.id}>{s.label}</option>
                            ))}
                        </select>
                    </div>

                    {/* Qui gère groupé */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ color: '#94a3b8', fontSize: 11 }}>Assigner :</span>
                        <select
                            onChange={(e) => {
                                if (e.target.value !== '') handleBulkSetQuiGere(e.target.value);
                            }}
                            defaultValue=""
                            style={{
                                height: 28,
                                minWidth: 130,
                                fontSize: 11,
                                background: '#1e293b',
                                color: '#f8fafc',
                                border: '1px solid #475569',
                                borderRadius: 6,
                                padding: '0 8px',
                                outline: 'none',
                                cursor: 'pointer',
                            }}
                        >
                            <option value="" disabled>Assigner...</option>
                            <option value="">Non assigné</option>
                            {effectiveGestionnaires.map((m) => (
                                <option key={m} value={m}>{m}</option>
                            ))}
                        </select>
                    </div>

                    {/* Catégorie groupée */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ color: '#94a3b8', fontSize: 11 }}>Catégorie :</span>
                        <select
                            onChange={(e) => {
                                if (e.target.value !== '') handleBulkSetCategorie(e.target.value);
                            }}
                            defaultValue=""
                            style={{
                                height: 28,
                                minWidth: 130,
                                fontSize: 11,
                                background: '#1e293b',
                                color: '#f8fafc',
                                border: '1px solid #475569',
                                borderRadius: 6,
                                padding: '0 8px',
                                outline: 'none',
                                cursor: 'pointer',
                            }}
                        >
                            <option value="" disabled>Catégoriser...</option>
                            <option value="">Sans catégorie</option>
                            {categories.map((c) => (
                                <option key={c.id} value={c.id}>{c.nom}</option>
                            ))}
                        </select>
                    </div>

                    <div style={{ height: 16, width: 1, background: '#334155' }} />

                    {/* Bouton supprimer */}
                    <button
                        type="button"
                        onClick={handleBulkDelete}
                        style={{
                            height: 28,
                            padding: '0 12px',
                            background: '#ef4444',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: 'pointer',
                        }}
                    >
                        Supprimer ({selectedIds.size})
                    </button>

                    {/* Annuler sélection */}
                    <button
                        type="button"
                        onClick={() => setSelectedIds(new Set())}
                        style={{
                            height: 28,
                            padding: '0 12px',
                            background: 'transparent',
                            color: '#cbd5e1',
                            border: '1px solid #475569',
                            borderRadius: 6,
                            fontSize: 11,
                            cursor: 'pointer',
                        }}
                    >
                        Désélectionner
                    </button>
                </div>
            )}

            {/* ─── Modale de gestion des options de statuts ───────────────────── */}
            {showColModal && (
                <ModalManageCustomColumns
                    columns={customColumns}
                    onClose={() => setShowColModal(false)}
                    onSave={(updatedCols) => {
                        setCustomColumns(updatedCols);
                    }}
                />
            )}

            {/* ─── Modale de gestion des gestionnaires ────────────────────────── */}
            {showGestionnairesModal && (
                <ModalManageGestionnaires
                    gestionnaires={effectiveGestionnaires}
                    onClose={() => setShowGestionnairesModal(false)}
                    onSave={(updated) => {
                        setGestionnaires(updated);
                    }}
                />
            )}

            {/* ─── Modale de planification de RDV rapide depuis le tableau ──── */}
            {selectedClientForRdv && (
                <ModalCreateRdv
                    preselectedClient={selectedClientForRdv}
                    clients={clients}
                    gestionnaires={effectiveGestionnaires}
                    allRdvs={allRdvs}
                    onClose={() => setSelectedClientForRdv(null)}
                    onSaved={async () => {
                        setSelectedClientForRdv(null);
                        const rdvs = await getAllRendezVous();
                        setAllRdvs(rdvs);
                        if (onReload) onReload();
                    }}
                />
            )}

            {/* ─── Modale de disponibilités et réservation rapide (Appel) ─── */}
            {showQuickAvailModal && (
                <ModalQuickAvailability
                    clients={clients}
                    onClose={() => setShowQuickAvailModal(false)}
                    onRdvBooked={async () => {
                        const rdvs = await getAllRendezVous();
                        setAllRdvs(rdvs);
                        if (onReload) onReload();
                    }}
                />
            )}

            {/* ─── POPOVER DE STATUT PERSONNALISÉ VIA PORTAL AU BODY ─── */}
            {activeDropdown && createPortal(
                <div
                    ref={popoverRef}
                    className="crm-popover"
                    style={{
                        position: 'fixed',
                        top: activeDropdown.openUp ? 'auto' : activeDropdown.top,
                        bottom: activeDropdown.openUp ? (window.innerHeight - activeDropdown.top + 4) : 'auto',
                        left: activeDropdown.left,
                        zIndex: 999999,
                        background: 'var(--bg)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.22)',
                        minWidth: 160,
                        padding: 4,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 2,
                    }}
                >
                    <div
                        onClick={() => saveCustomFieldValue(activeDropdown.clientId, activeDropdown.colId, '')}
                        style={{ padding: '5px 8px', fontSize: 11, color: '#64748b', cursor: 'pointer', borderRadius: 4 }}
                        className="crm-popover-item"
                    >
                        Effacer statut
                    </div>
                    {activeDropdown.colOptions.map((opt) => (
                        <div
                            key={opt.id}
                            onClick={() => saveCustomFieldValue(activeDropdown.clientId, activeDropdown.colId, opt.id)}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                padding: '5px 8px',
                                fontSize: 11,
                                cursor: 'pointer',
                                borderRadius: 4,
                                fontWeight: opt.id === activeDropdown.currentOptId ? 700 : 500,
                                background: opt.id === activeDropdown.currentOptId ? 'var(--bg3)' : 'transparent',
                                color: opt.color,
                            }}
                            className="crm-popover-item"
                        >
                            <div style={{ width: 8, height: 8, borderRadius: '50%', background: opt.color }} />
                            <span>{opt.label}</span>
                        </div>
                    ))}
                </div>,
                document.body
            )}

            {/* ─── MENU DU BOUTON "+" DANS L'EN-TÊTE DU TABLEAU (PORTAL AU BODY) ─── */}
            {showAddColMenu && createPortal(
                <div
                    ref={addColMenuRef}
                    className="crm-popover"
                    style={{
                        position: 'fixed',
                        top: addColMenuPos.top,
                        left: addColMenuPos.left,
                        zIndex: 999999,
                        background: 'var(--bg)',
                        border: '1px solid var(--border)',
                        borderRadius: 8,
                        boxShadow: '0 10px 25px rgba(0, 0, 0, 0.2)',
                        minWidth: 230,
                        padding: 6,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 3,
                    }}
                >
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>
                        Ajouter une colonne
                    </div>

                    {/* 1. Colonne de texte libre : Création instantanée avec focus direct */}
                    <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => {
                            setShowAddColMenu(false);
                            handleCreateNewTextColumn();
                        }}
                        style={{ justifyContent: 'flex-start', fontSize: 12, padding: '6px 8px', color: 'var(--accent)', fontWeight: 600 }}
                    >
                        + Colonne de texte
                    </button>

                    {/* 2. Colonne avec statut */}
                    <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => {
                            setShowAddColMenu(false);
                            setShowColModal(true);
                        }}
                        style={{ justifyContent: 'flex-start', fontSize: 12, padding: '6px 8px', color: 'var(--text)' }}
                    >
                        + Colonne avec statut
                    </button>

                    <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />

                    {/* Réinitialisations */}
                    <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => {
                            saveOrder(null);
                            setShowAddColMenu(false);
                        }}
                        style={{ justifyContent: 'flex-start', fontSize: 11, padding: '5px 8px', color: 'var(--text-muted)' }}
                    >
                        ↺ Réinitialiser l'ordre des colonnes
                    </button>

                    {Object.keys(customColumnLabels).length > 0 && (
                        <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => {
                                resetStandardColumnLabels();
                                setShowAddColMenu(false);
                            }}
                            style={{ justifyContent: 'flex-start', fontSize: 11, padding: '5px 8px', color: 'var(--text-muted)' }}
                        >
                            ↺ Rétablir les noms d'origine
                        </button>
                    )}

                    {/* Colonnes standard masquées */}
                    {hiddenStandardCols.length > 0 && (
                        <>
                            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-light)', padding: '6px 8px 2px', textTransform: 'uppercase' }}>
                                Colonnes masquées ({hiddenStandardCols.length})
                            </div>
                            {hiddenStandardCols.map((colKey) => {
                                const colDef = STANDARD_COLUMNS.find((c) => c.key === colKey);
                                return (
                                    <div
                                        key={colKey}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            padding: '4px 8px',
                                            fontSize: 11,
                                            borderRadius: 4,
                                            background: 'var(--bg3)',
                                        }}
                                    >
                                        <span>{customColumnLabels[colKey] || colDef?.label || colKey}</span>
                                        <button
                                            type="button"
                                            onClick={() => restoreStandardCol(colKey)}
                                            className="btn btn--primary btn--sm"
                                            style={{ padding: '1px 6px', fontSize: 10, height: 20 }}
                                        >
                                            Afficher
                                        </button>
                                    </div>
                                );
                            })}
                        </>
                    )}
                </div>,
                document.body
            )}
        </div>
    );
}
