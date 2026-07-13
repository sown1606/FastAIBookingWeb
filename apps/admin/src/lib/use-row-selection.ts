import { useCallback, useEffect, useMemo, useState } from "react";

interface ToggleOptions {
  shiftKey?: boolean;
}

export const getVisibleRangeIds = (
  visibleIds: string[],
  anchorId: string | null,
  targetId: string
): string[] => {
  if (!anchorId) {
    return [];
  }
  const anchorIndex = visibleIds.indexOf(anchorId);
  const targetIndex = visibleIds.indexOf(targetId);
  if (anchorIndex < 0 || targetIndex < 0) {
    return [];
  }
  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return visibleIds.slice(start, end + 1);
};

export const useRowSelection = (visibleIds: string[]) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const visibleIdKey = visibleIds.join("|");
  const visibleIdSet = useMemo(() => new Set(visibleIds), [visibleIdKey]);

  const reconcileVisibleIds = useCallback(
    (nextVisibleIds = visibleIds) => {
      const nextVisibleIdSet = new Set(nextVisibleIds);
      setAnchorId((current) => (current && nextVisibleIdSet.has(current) ? current : null));
      setSelectedIds((current) => {
        const reconciled = new Set([...current].filter((id) => nextVisibleIdSet.has(id)));
        return reconciled.size === current.size ? current : reconciled;
      });
    },
    [visibleIdKey]
  );

  useEffect(() => {
    reconcileVisibleIds(visibleIds);
  }, [reconcileVisibleIds, visibleIdKey]);

  const toggleOne = useCallback(
    (id: string, options: ToggleOptions = {}) => {
      if (!visibleIdSet.has(id)) {
        return;
      }
      const rangeIds = options.shiftKey ? getVisibleRangeIds(visibleIds, anchorId, id) : [];
      if (rangeIds.length > 1) {
        setSelectedIds((current) => {
          const next = new Set(current);
          rangeIds.forEach((rangeId) => next.add(rangeId));
          return next;
        });
        return;
      }

      setAnchorId(id);
      setSelectedIds((current) => {
        const next = new Set(current);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
    },
    [anchorId, visibleIdKey, visibleIdSet]
  );

  const selectAllVisible = useCallback(() => {
    setSelectedIds((current) => {
      const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => current.has(id));
      const next = new Set(current);
      if (allVisibleSelected) {
        visibleIds.forEach((id) => next.delete(id));
        setAnchorId(null);
      } else {
        visibleIds.forEach((id) => next.add(id));
        setAnchorId(visibleIds[0] ?? null);
      }
      return next;
    });
  }, [visibleIdKey]);

  const clearAll = useCallback(() => {
    setAnchorId(null);
    setSelectedIds(new Set());
  }, []);

  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someVisibleSelected = visibleIds.some((id) => selectedIds.has(id));

  return {
    selectedIds,
    toggleOne,
    selectAllVisible,
    clearAll,
    allVisibleSelected,
    someVisibleSelected,
    reconcileVisibleIds,
    anchorId,
    visibleIdSet
  };
};
