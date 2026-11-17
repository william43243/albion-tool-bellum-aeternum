import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ScrollView,
  Modal,
  Keyboard,
  Platform,
  StyleSheet,
} from 'react-native';
import BellumIcon from './BellumIcon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, SPACING, FONT_SIZE, BORDER_RADIUS } from '../constants/theme';
import {
  AlbionItem,
  searchItems,
  ITEM_CATEGORIES,
  CATEGORY_LABELS,
  ItemCategory,
  getItemCount,
  getItemsByIds,
} from '../lib/items';
import { Language } from '../lib/i18n';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelect: (item: AlbionItem) => void;
  lang: Language;
  multiSelect?: boolean;
  selectedIds?: string[];
  onMultiSelect?: (items: AlbionItem[]) => void;
}

const labelsEs: Record<ItemCategory,string> = {
  resource:'Recursos', equipment:'Equipo', weapon:'Armas', consumable:'Consumibles',
  mount:'Monturas', farmable:'Agricultura', furniture:'Muebles', journal:'Diarios', trophy:'Trofeos',
};
const TIERS = ['3', '4', '5', '6', '7', '8'];

export default function ItemPicker({
  visible,
  onClose,
  onSelect,
  lang,
  multiSelect,
  selectedIds = [],
  onMultiSelect,
}: Props) {
  const insets = useSafeAreaInsets();
  const [keyboardTop, setKeyboardTop] = useState<number | null>(null);
  useEffect(() => {
    if (!visible || Platform.OS !== 'android') { setKeyboardTop(null); return; }
    const show = Keyboard.addListener('keyboardDidShow', event => setKeyboardTop(event.endCoordinates.screenY));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardTop(null));
    setKeyboardTop(Keyboard.isVisible() ? Keyboard.metrics()?.screenY ?? null : null);
    return () => { show.remove(); hide.remove(); };
  }, [visible]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [tier, setTier] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set(selectedIds));

  const filteredItems = useMemo(() => {
    return searchItems(search, category || undefined, tier || undefined, 80);
  }, [search, category, tier]);

  const handleItemPress = useCallback(
    (item: AlbionItem) => {
      if (multiSelect) {
        setSelected((prev) => {
          const newSet = new Set(prev);
          if (newSet.has(item.id)) {
            newSet.delete(item.id);
          } else {
            newSet.add(item.id);
          }
          return newSet;
        });
      } else {
        onSelect(item);
        onClose();
      }
    },
    [multiSelect, onSelect, onClose]
  );

  const handleConfirm = () => {
    if (onMultiSelect) {
      // Search limits and active filters must never truncate the selection.
      onMultiSelect(getItemsByIds(selected));
    }
    onClose();
  };

  const renderItem = useCallback(
    ({ item }: { item: AlbionItem }) => {
      const isSelected = selected.has(item.id);
      return (
        <TouchableOpacity
          accessibilityRole={multiSelect ? "checkbox" : "button"}
          accessibilityState={multiSelect ? {checked: isSelected} : undefined}
          style={[styles.itemRow, isSelected && styles.itemRowSelected]}
          onPress={() => handleItemPress(item)}
          activeOpacity={0.6}
        >
          <View style={styles.itemInfo}>
            <Text style={styles.itemName} numberOfLines={1}>
              {item.n}
            </Text>
            <Text style={styles.itemId} numberOfLines={1}>
              {item.id}
            </Text>
          </View>
          <View style={styles.itemMeta}>
            {item.t ? (
              <View style={styles.tierBadge}>
                <Text style={styles.tierText}>T{item.t}</Text>
              </View>
            ) : null}
            {item.iv > 0 && (
              <Text style={styles.itemValue}>IV:{item.iv}</Text>
            )}
          </View>
          {multiSelect && (
            <View style={[styles.checkbox, isSelected && {borderColor: COLORS.primary}]}>{isSelected && <BellumIcon name="check" size={16} color={COLORS.primary} />}</View>
          )}
        </TouchableOpacity>
      );
    },
    [selected, handleItemPress, multiSelect]
  );

  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <View style={styles.overlay}>
        {/* This modal starts at screen Y=0; the IME top is its usable height. */}
        <View style={[styles.sheetViewport, { paddingTop: insets.top }, keyboardTop !== null && { bottom: undefined, height: keyboardTop }]}>
        <View style={[styles.modal, { paddingBottom: keyboardTop !== null ? SPACING.sm : Math.max(insets.bottom, SPACING.xl), paddingLeft: insets.left, paddingRight: insets.right }]} accessibilityViewIsModal>
          {/* Header */}
          <View style={[styles.header, keyboardTop !== null && { paddingVertical: SPACING.sm }]}>
            <View>
              <Text style={styles.title}>
                {lang === 'fr' ? 'Rechercher un objet' : lang === 'es' ? 'Buscar un objeto' : 'Search items'}
              </Text>
              {keyboardTop === null && <Text style={styles.subtitle}>
                {getItemCount().toLocaleString()} {lang === 'fr' ? 'objets' : lang === 'es' ? 'objetos' : 'items'}
              </Text>}
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtnWrap} accessibilityRole="button" accessibilityLabel={lang === "fr" ? "Fermer" : lang === "es" ? "Cerrar" : "Close"}>
              <BellumIcon name="close" color={COLORS.text} size={20} />
            </TouchableOpacity>
          </View>

          {/* Search */}
          <TextInput
            style={styles.searchInput}
            placeholder={
              lang === 'fr' ? 'Nom, ID ou mot-clé…' : lang === 'es' ? 'Nombre, ID o palabra clave…' : 'Name, ID or keyword…'
            }
            placeholderTextColor={COLORS.textMuted}
            value={search}
            onChangeText={setSearch}
            autoFocus
          />

          {/* Tier filter */}
          <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} style={{flexGrow: 0, flexShrink: 0}} contentContainerStyle={styles.filterRow}>
            <TouchableOpacity
              style={[styles.filterChip, !tier && styles.filterChipActive]}
              accessibilityRole="button" accessibilityState={{selected: !tier}}
                onPress={() => setTier(null)}
            >
              <Text style={[styles.filterText, !tier && styles.filterTextActive]}>
                {lang === 'fr' ? 'Tous' : lang === 'es' ? 'Todos' : 'All'}
              </Text>
            </TouchableOpacity>
            {TIERS.map((t) => (
              <TouchableOpacity
                key={t}
                style={[styles.filterChip, tier === t && styles.filterChipActive]}
                accessibilityRole="button" accessibilityState={{selected: tier === t}}
                onPress={() => setTier(tier === t ? null : t)}
              >
                <Text style={[styles.filterText, tier === t && styles.filterTextActive]}>
                  T{t}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Category filter */}
          <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} style={{flexGrow: 0, flexShrink: 0}} contentContainerStyle={styles.filterRow}>
            <TouchableOpacity
              style={[styles.filterChip, !category && styles.filterChipActive]}
              accessibilityRole="button" accessibilityState={{selected: !category}}
                onPress={() => setCategory(null)}
            >
              <Text style={[styles.filterText, !category && styles.filterTextActive]}>
                {lang === 'fr' ? 'Tout' : lang === 'es' ? 'Todo' : 'All'}
              </Text>
            </TouchableOpacity>
            {ITEM_CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat}
                style={[styles.filterChip, category === cat && styles.filterChipActive]}
                accessibilityRole="button" accessibilityState={{selected: category === cat}}
                onPress={() => setCategory(category === cat ? null : cat)}
              >
                <Text
                  style={[styles.filterText, category === cat && styles.filterTextActive]}
                >
                  {lang === 'es' ? labelsEs[cat] : CATEGORY_LABELS[cat]?.[lang] || cat}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Results count */}
          <Text style={styles.resultCount}>
            {filteredItems.length} {lang === 'fr' ? 'résultats' : lang === 'es' ? 'resultados' : 'results'}
            {filteredItems.length >= 80
              ? lang === 'fr'
                ? ' (affiner la recherche)'
                : lang === 'es' ? ' (acota la búsqueda)' : ' (refine search)'
              : ''}
          </Text>

          {/* Item list */}
          <FlatList
            keyboardShouldPersistTaps="handled"
            data={filteredItems}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            style={styles.list}
            initialNumToRender={20}
            maxToRenderPerBatch={20}
            windowSize={5}
            getItemLayout={(_, index) => ({
              length: 56,
              offset: 56 * index,
              index,
            })}
          />

          {/* Confirm button (multi-select) */}
          {multiSelect && (
            <TouchableOpacity style={styles.confirmBtn} onPress={handleConfirm}>
              <Text style={styles.confirmText}>
                {lang === 'fr'
                  ? `Confirmer (${selected.size})`
                  : lang === 'es' ? `Confirmar (${selected.size})` : `Confirm (${selected.size})`}
              </Text>
            </TouchableOpacity>
          )}
        </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: COLORS.overlay,
  },
  sheetViewport: {
    position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
    justifyContent: 'flex-end',
  },
  modal: {
    flex: 1,
    backgroundColor: COLORS.background,
    borderTopLeftRadius: BORDER_RADIUS.xl,
    borderTopRightRadius: BORDER_RADIUS.xl,
    paddingBottom: SPACING.xl,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  title: {
    color: COLORS.text,
    fontSize: FONT_SIZE.xl,
    fontWeight: '700',
  },
  subtitle: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
    marginTop: 2,
  },
  closeBtnWrap: {
    minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center',
  },
  searchInput: {
    backgroundColor: COLORS.surface,
    margin: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    color: COLORS.text,
    fontSize: FONT_SIZE.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    gap: SPACING.xs,
    marginBottom: SPACING.xs,
  },
  filterChip: {
    minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: BORDER_RADIUS.sm,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  filterChipActive: {
    backgroundColor: COLORS.primarySoft,
    borderColor: COLORS.primary,
  },
  filterText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
  },
  filterTextActive: {
    color: COLORS.primary,
    fontWeight: '600',
  },
  resultCount: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.xs,
  },
  list: {
    flex: 1,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    height: 56,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  itemRowSelected: {
    backgroundColor: COLORS.primaryFaint,
  },
  itemInfo: {
    flex: 1,
    marginRight: SPACING.sm,
  },
  itemName: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontWeight: '500',
  },
  itemId: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
    marginTop: 1,
  },
  itemMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    marginRight: SPACING.sm,
  },
  tierBadge: {
    backgroundColor: COLORS.surface2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  tierText: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.xs,
    fontWeight: '700',
  },
  itemValue: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
  },
  checkbox: { width: 20, height: 20, borderWidth: 1, borderColor: COLORS.borderStrong, alignItems: 'center', justifyContent: 'center', borderRadius: 3 },
  confirmBtn: {
    minHeight: 48, justifyContent: 'center',
    backgroundColor: COLORS.primary,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.md,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
  },
  confirmText: {
    color: COLORS.onPrimary,
    fontSize: FONT_SIZE.lg,
    fontWeight: '700',
  },
});
