import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  Modal,
  StyleSheet,
} from 'react-native';
import { COLORS, SPACING, FONT_SIZE, BORDER_RADIUS } from '../constants/theme';
import {
  AlbionItem,
  searchItems,
  ITEM_CATEGORIES,
  CATEGORY_LABELS,
  ItemCategory,
  getItemCount,
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
      const items = filteredItems.filter((i) => selected.has(i.id));
      // Also include previously selected items not in current filter
      const allItems = searchItems('', undefined, undefined, 10000);
      const selectedItems = allItems.filter((i) => selected.has(i.id));
      onMultiSelect(selectedItems);
    }
    onClose();
  };

  const renderItem = useCallback(
    ({ item }: { item: AlbionItem }) => {
      const isSelected = selected.has(item.id);
      return (
        <TouchableOpacity
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
            <Text style={styles.checkbox}>{isSelected ? '\u2611' : '\u2610'}</Text>
          )}
        </TouchableOpacity>
      );
    },
    [selected, handleItemPress, multiSelect]
  );

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>
                {lang === 'fr' ? 'Rechercher un item' : 'Search item'}
              </Text>
              <Text style={styles.subtitle}>
                {getItemCount().toLocaleString()} items
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtnWrap}>
              <Text style={styles.closeBtn}>\u2715</Text>
            </TouchableOpacity>
          </View>

          {/* Search */}
          <TextInput
            style={styles.searchInput}
            placeholder={
              lang === 'fr' ? 'Nom, ID ou mot-cl\u00e9...' : 'Name, ID or keyword...'
            }
            placeholderTextColor={COLORS.textMuted}
            value={search}
            onChangeText={setSearch}
            autoFocus
          />

          {/* Tier filter */}
          <View style={styles.filterRow}>
            <TouchableOpacity
              style={[styles.filterChip, !tier && styles.filterChipActive]}
              onPress={() => setTier(null)}
            >
              <Text style={[styles.filterText, !tier && styles.filterTextActive]}>
                {lang === 'fr' ? 'Tous' : 'All'}
              </Text>
            </TouchableOpacity>
            {TIERS.map((t) => (
              <TouchableOpacity
                key={t}
                style={[styles.filterChip, tier === t && styles.filterChipActive]}
                onPress={() => setTier(tier === t ? null : t)}
              >
                <Text style={[styles.filterText, tier === t && styles.filterTextActive]}>
                  T{t}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Category filter */}
          <View style={styles.filterRow}>
            <TouchableOpacity
              style={[styles.filterChip, !category && styles.filterChipActive]}
              onPress={() => setCategory(null)}
            >
              <Text style={[styles.filterText, !category && styles.filterTextActive]}>
                {lang === 'fr' ? 'Tout' : 'All'}
              </Text>
            </TouchableOpacity>
            {ITEM_CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat}
                style={[styles.filterChip, category === cat && styles.filterChipActive]}
                onPress={() => setCategory(category === cat ? null : cat)}
              >
                <Text
                  style={[styles.filterText, category === cat && styles.filterTextActive]}
                >
                  {CATEGORY_LABELS[cat]?.[lang] || cat}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Results count */}
          <Text style={styles.resultCount}>
            {filteredItems.length} {lang === 'fr' ? 'r\u00e9sultats' : 'results'}
            {filteredItems.length >= 80
              ? lang === 'fr'
                ? ' (affiner la recherche)'
                : ' (refine search)'
              : ''}
          </Text>

          {/* Item list */}
          <FlatList
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
                  : `Confirm (${selected.size})`}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: '#00000099',
    justifyContent: 'flex-end',
  },
  modal: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: BORDER_RADIUS.xl,
    borderTopRightRadius: BORDER_RADIUS.xl,
    maxHeight: '90%',
    minHeight: '70%',
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
    padding: SPACING.sm,
  },
  closeBtn: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.xl,
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
    flexWrap: 'wrap',
    paddingHorizontal: SPACING.md,
    gap: SPACING.xs,
    marginBottom: SPACING.xs,
  },
  filterChip: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: BORDER_RADIUS.sm,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  filterChipActive: {
    backgroundColor: COLORS.primary + '25',
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
    borderBottomColor: COLORS.border + '30',
  },
  itemRowSelected: {
    backgroundColor: COLORS.primary + '15',
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
    backgroundColor: COLORS.primary + '20',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  tierText: {
    color: COLORS.primary,
    fontSize: FONT_SIZE.xs,
    fontWeight: '700',
  },
  itemValue: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
  },
  checkbox: {
    color: COLORS.primary,
    fontSize: FONT_SIZE.xl,
  },
  confirmBtn: {
    backgroundColor: COLORS.primary,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.md,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
  },
  confirmText: {
    color: COLORS.background,
    fontSize: FONT_SIZE.lg,
    fontWeight: '700',
  },
});
