/* eslint-disable @next/next/no-img-element */
"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Search, ChevronRight, ImageIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import ToolTip from "@/components/ToolTip";
import { cn } from "@/lib/utils";
import { notify } from "@/components/ui/sonner";
import type {
  StockImageProviderId,
  StockImageResult,
} from "@/lib/stock-image-providers";

const SEARCH_DEBOUNCE_MS = 500;
const PER_PAGE = 24;

interface AvailableProvider {
  id: StockImageProviderId;
  label: string;
}

const useDebouncedValue = <T,>(value: T, delay: number) => {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => window.clearTimeout(timeoutId);
  }, [delay, value]);

  return debouncedValue;
};

interface StockPhotoEditorProps {
  initialQuery?: string;
  onClose?: () => void;
  onPhotoChange?: (result: StockImageResult) => void;
}

interface SearchResponse {
  provider?: StockImageProviderId;
  page?: number;
  total?: number;
  results?: StockImageResult[];
  error?: string;
}

const StockPhotoEditor = ({
  initialQuery = "",
  onClose,
  onPhotoChange,
}: StockPhotoEditorProps) => {
  const requestIdRef = useRef(0);
  const closeTimeoutRef = useRef<number | null>(null);

  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [providers, setProviders] = useState<AvailableProvider[]>([]);
  const [selectedProvider, setSelectedProvider] =
    useState<StockImageProviderId | null>(null);
  const [results, setResults] = useState<StockImageResult[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [selectedResult, setSelectedResult] = useState<StockImageResult | null>(
    null,
  );
  const [isOpen, setIsOpen] = useState(true);

  const activeQuery = useMemo(() => searchQuery.trim(), [searchQuery]);
  const debouncedActiveQuery = useDebouncedValue(activeQuery, SEARCH_DEBOUNCE_MS);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/stock-images/providers")
      .then((r) => r.json())
      .then((data: { providers?: AvailableProvider[] }) => {
        if (cancelled) return;
        const list = data.providers ?? [];
        setProviders(list);
        setSelectedProvider((current) => current ?? list[0]?.id ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        window.clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    if (closeTimeoutRef.current) {
      window.clearTimeout(closeTimeoutRef.current);
    }
    closeTimeoutRef.current = window.setTimeout(() => {
      onClose?.();
    }, 300);
  }, [onClose]);

  const runSearch = useCallback(
    async (
      query: string,
      providerId: StockImageProviderId | null,
      nextPage: number,
      mode: "replace" | "append",
    ) => {
      if (!providerId || !query) {
        setResults([]);
        setTotal(0);
        setHasMore(false);
        setLoading(false);
        setLoadingMore(false);
        return;
      }
      if (mode === "replace") setLoading(true);
      else setLoadingMore(true);

      const requestId = ++requestIdRef.current;
      const url = `/api/stock-images/search?query=${encodeURIComponent(
        query,
      )}&provider=${encodeURIComponent(providerId)}&page=${nextPage}&per_page=${PER_PAGE}`;

      try {
        const res = await fetch(url);
        const data = (await res.json()) as SearchResponse;
        if (!res.ok || !data.results) {
          throw new Error(data.error || `Search failed (${res.status})`);
        }
        if (requestIdRef.current !== requestId) return;
        setResults((prev) =>
          mode === "append" ? [...prev, ...data.results!] : data.results!,
        );
        setTotal(data.total ?? data.results.length);
        setPage(nextPage);
        setHasMore(
          mode === "append"
            ? data.results.length > 0
            : data.results.length < (data.total ?? 0),
        );
      } catch (error) {
        if (requestIdRef.current !== requestId) return;
        console.error("Error fetching stock photos:", error);
        notify.error(
          "Could not load photos",
          error instanceof Error
            ? error.message
            : "Failed to fetch photos. Please try again.",
        );
        if (mode === "replace") setResults([]);
      } finally {
        if (requestIdRef.current === requestId) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    runSearch(debouncedActiveQuery, selectedProvider, 1, "replace");
  }, [debouncedActiveQuery, runSearch, selectedProvider]);

  const handleProviderSelect = (id: StockImageProviderId) => {
    setSelectedProvider(id);
  };

  const handleLoadMore = () => {
    if (loading || loadingMore || !hasMore) return;
    runSearch(activeQuery, selectedProvider, page + 1, "append");
  };

  const handleUsePhoto = () => {
    if (!selectedResult) {
      notify.warning("Photo required", "Select a photo before applying.");
      return;
    }
    onPhotoChange?.(selectedResult);
    handleClose();
  };

  return (
    <div className="stock-photo-editor-container">
      <Sheet
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) handleClose();
        }}
      >
        <SheetContent
          side="right"
          data-inline-edit-ignore="true"
          className="flex h-full w-[400px] max-w-[calc(100vw-16px)] flex-col gap-0 border-l border-[#EDEEEF] bg-white p-0 font-syne shadow-xl sm:max-w-[400px] [&>button]:right-4 [&>button]:top-4"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onClick={(e) => e.stopPropagation()}
        >
          <SheetHeader className="border-b border-[#EDEEEF] px-4 py-4 text-left">
            <SheetTitle className="text-sm font-semibold text-[#191919]">
              Stock Photo
            </SheetTitle>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="space-y-3.5 px-4 py-[18px]">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  runSearch(activeQuery, selectedProvider, 1, "replace");
                }}
              >
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9B9CA3]" />
                  <Input
                    placeholder="Search photos (e.g. mountains, office, team)"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="h-10 rounded-[8px] border-[#E4E5E8] bg-white pl-9 text-[12px] text-[#191919] shadow-none placeholder:text-[#A3A3AA] focus-visible:ring-1 focus-visible:ring-[#D8C8FF]"
                  />
                </div>
              </form>

              {providers.length > 1 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-[11px] font-medium text-[#666666]">
                    Provider
                  </span>
                  {providers.map((provider) => {
                    const isSelected = selectedProvider === provider.id;
                    return (
                      <button
                        key={provider.id}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleProviderSelect(provider.id);
                        }}
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                          isSelected
                            ? "border-[#D9D6FE] bg-[#F4F3FF] text-[#7A5AF8]"
                            : "border-[#E4E5E8] bg-white text-[#666666] hover:bg-[#F7F7FA]",
                        )}
                      >
                        {provider.label}
                      </button>
                    );
                  })}
                </div>
              )}

              {providers.length === 0 && !loading && (
                <div className="flex items-start gap-1.5 rounded-[8px] border border-[#FFE3B3] bg-[#FFF8EC] p-2.5 text-[11px] text-[#7A5A1E]">
                  <ToolTip content="Set PEXELS_API_KEY, UNSPLASH_ACCESS_KEY, or PIXABAY_API_KEY in FE-codebase/.env.local, then restart the dev server.">
                    <span className="font-medium">
                      No stock provider configured. Ask your admin to set an API
                      key server-side.
                    </span>
                  </ToolTip>
                </div>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
              {loading ? (
                <div className="grid grid-cols-2 gap-3 py-1">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <Skeleton key={index} className="aspect-video rounded-[8px]" />
                  ))}
                </div>
              ) : results.length > 0 ? (
                <>
                  <div className="grid grid-cols-2 gap-3 py-1">
                    {results.map((result, index) => {
                      const isSelected =
                        selectedResult?.id === result.id;
                      return (
                        <button
                          key={`${result.id}-${index}`}
                          type="button"
                          aria-label={`Select photo ${index + 1} by ${result.credit}`}
                          aria-pressed={isSelected}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedResult(result);
                          }}
                          className={cn(
                            "group relative overflow-hidden rounded-[8px] border transition-colors",
                            isSelected
                              ? "border-[#7A5AF8] ring-2 ring-[#D9D6FE]"
                              : "border-transparent hover:border-[#becff5]",
                          )}
                        >
                          <img
                            src={result.thumbnail}
                            alt=""
                            loading="lazy"
                            draggable={false}
                            className="aspect-video w-full object-cover"
                          />
                          <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5 text-left text-[10px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
                            {result.credit}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {hasMore && (
                    <div className="mt-4 flex justify-center">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={loadingMore}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleLoadMore();
                        }}
                        className="h-8 rounded-full border-[#E4E5E8] text-[12px] font-medium text-[#191919] shadow-none hover:bg-[#F4F3FF]"
                      >
                        {loadingMore ? "Loading…" : "Load more"}
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex h-44 flex-col items-center justify-center text-center text-[#73737A]">
                  <ImageIcon className="mb-3 h-8 w-8 text-[#B7B8BE]" />
                  <p className="text-[12px] font-medium">No photos found</p>
                  <p className="mt-1 text-[11px]">
                    {activeQuery
                      ? "Try a different search term."
                      : "Type a search term to begin."}
                  </p>
                </div>
              )}
            </div>

            <div className="px-4 pb-4 pt-2">
              <Button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleUsePhoto();
                }}
                style={{
                  background:
                    "linear-gradient(270deg, #D5CAFC 2.4%, #E3D2EB 27.88%, #F4DCD3 69.23%, #FDE4C2 100%)",
                }}
                disabled={!selectedResult}
                className="h-10 rounded-full px-4 text-sm font-semibold text-[#101323] shadow-none hover:bg-[#F2DDAA] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Use this photo
                <ChevronRight className="h-4 w-4" />
              </Button>
              {selectedResult?.credit ? (
                <p className="mt-2 text-[10px] text-[#888]">
                  Photo by{" "}
                  {selectedResult.creditUrl ? (
                    <a
                      href={selectedResult.creditUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {selectedResult.credit}
                    </a>
                  ) : (
                    selectedResult.credit
                  )}
                </p>
              ) : null}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default StockPhotoEditor;
