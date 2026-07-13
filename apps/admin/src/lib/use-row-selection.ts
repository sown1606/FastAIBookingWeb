import { useCallback, useEffect, useMemo, useState } from "react";

export const useRowSelection = (visibleIds: string[]) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const visibleIdKey = visibleIds.join("|");
  const visibleIdSet = useMemo(() => new Set(visibleIds), [visibleIdKey]);

  const reconcileVisibleIds = useCallback(
    (nextVisibleIds = visibleIds) => {
      const nextVisibleIdSet = new Set(nextVisibleIds);
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

  const toggleOne = useCallback((id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAllVisible = useCallback(() => {
    setSelectedIds((current) => {
      const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => current.has(id));
      const next = new Set(current);
      if (allVisibleSelected) {
        visibleIds.forEach((id) => next.delete(id));
      } else {
        visibleIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }, [visibleIdKey]);

  const clearAll = useCallback(() => {
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
    visibleIdSet
  };
};
