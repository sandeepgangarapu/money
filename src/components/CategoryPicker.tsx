import { Check, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import s from "../App.module.css";
import { categoryAppearance } from "../data/appearance";
import {
  type CategoryChoice,
  categoryChoiceSections,
  recentCategoryChoices,
  rememberCategory,
} from "../data/categoryChoices";
import { categories } from "../data/finance";
import { EmojiTile, PickerButton, Sheet } from "./Primitives";
import type { TransactionPatch } from "./Transactions";

type CategoryPickerProps = {
  category: string | null;
  subcategory: string;
  onChange: (patch: TransactionPatch) => void;
  allowUncategorized?: boolean;
  label?: string;
};

export function CategoryPicker({
  category,
  subcategory,
  label = subcategory,
  ...props
}: CategoryPickerProps) {
  const [open, setOpen] = useState(false);
  const appearance = categoryAppearance(
    categories.find((group) => group.id === category)?.name ?? "Uncategorized",
    subcategory,
  );
  return (
    <>
      <PickerButton
        className={s.categoryPickerTrigger}
        aria-label={`Change category, ${label}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <span className={s.categoryPickerLabel}>
          <EmojiTile {...appearance} size={28} />
          {label}
        </span>
      </PickerButton>
      <CategoryPickerSheet
        {...props}
        category={category}
        subcategory={subcategory}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

export function CategoryPickerSheet({
  open,
  onClose,
  ...props
}: CategoryPickerProps & { open: boolean; onClose: () => void }) {
  return open ? <CategoryChoices {...props} onClose={onClose} /> : null;
}

function CategoryChoices({
  category,
  subcategory,
  onChange,
  allowUncategorized = true,
  onClose,
}: CategoryPickerProps & { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(
    category && category !== "uncategorized"
      ? `${category}|${subcategory}`
      : "",
  );
  const search = useRef<HTMLInputElement>(null);
  const id = useId();
  const sections = categoryChoiceSections(
    categories,
    query,
    allowUncategorized,
  );
  const choices = sections.flatMap((section) => section.choices);
  const activeIndex = Math.max(
    0,
    choices.findIndex((choice) => choice.key === active),
  );
  const selected = `${category ?? "uncategorized"}|${subcategory}`;
  const recents = recentCategoryChoices(categories, {
    selected,
    allowUncategorized,
  });
  const activeId = choices[activeIndex]
    ? `${id}-option-${encodeURIComponent(choices[activeIndex].key)}`
    : undefined;

  useEffect(() => {
    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches)
      search.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (activeId)
      document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  function choose(choice: CategoryChoice) {
    rememberCategory(choice.category, choice.subcategory);
    onClose();
    onChange({ category: choice.category, subcategory: choice.subcategory });
  }

  return (
    <Sheet title="Choose category" size="tall" onClose={onClose}>
      <div className={s.categorySearch}>
        <Search size={18} aria-hidden="true" />
        <input
          ref={search}
          type="search"
          role="combobox"
          aria-label="Search categories"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls={`${id}-list`}
          aria-activedescendant={activeId}
          placeholder="Search categories…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive("");
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const step = event.key === "ArrowDown" ? 1 : -1;
              const index = Math.min(
                choices.length - 1,
                Math.max(0, activeIndex + step),
              );
              setActive(choices[index]?.key ?? "");
            } else if (event.key === "Enter") {
              event.preventDefault();
              if (choices[activeIndex]) choose(choices[activeIndex]);
            }
          }}
        />
        {query && (
          <button
            type="button"
            className={s.iconButton}
            aria-label="Clear category search"
            onClick={() => {
              setQuery("");
              setActive("");
              search.current?.focus();
            }}
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>
      {!query && recents.length > 0 && (
        <div
          className={s.categoryRecent}
          // biome-ignore lint/a11y/useSemanticElements: Recent shortcuts form a horizontal button group.
          role="group"
          aria-label="Recent categories"
        >
          <span className={s.categoryRecentLabel}>Recent</span>
          {recents.map((choice) => (
            <button
              key={choice.key}
              type="button"
              className={s.categoryRecentPill}
              aria-label={`Choose ${choice.subcategory}`}
              onClick={() => choose(choice)}
            >
              <span aria-hidden="true">{choice.appearance.emoji}</span>
              <span className={s.categoryRecentName}>{choice.subcategory}</span>
            </button>
          ))}
        </div>
      )}
      <div className={s.categoryPickerResults}>
        <div
          id={`${id}-list`}
          className={s.categoryChoices}
          // biome-ignore lint/a11y/useSemanticElements: The searchable combobox needs a styled listbox popup.
          role="listbox"
          tabIndex={-1}
          aria-label="Categories"
        >
          {sections.map((section) => (
            <div
              key={section.id}
              className={s.categoryChoiceSection}
              role={section.heading ? "group" : "presentation"}
              aria-labelledby={
                section.heading ? `${id}-group-${section.id}` : undefined
              }
            >
              {section.heading && (
                <div
                  id={`${id}-group-${section.id}`}
                  className={s.categoryChoiceHeading}
                >
                  <EmojiTile {...section.heading.appearance} size={28} />
                  {section.heading.name}
                </div>
              )}
              {section.choices.map((choice) => (
                <button
                  key={choice.key}
                  id={`${id}-option-${encodeURIComponent(choice.key)}`}
                  type="button"
                  // biome-ignore lint/a11y/useSemanticElements: This is an option in the searchable combobox popup.
                  role="option"
                  tabIndex={-1}
                  aria-selected={choice.key === selected}
                  className={s.categoryChoice}
                  data-active={choice.key === choices[activeIndex]?.key}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(choice)}
                >
                  <EmojiTile {...choice.appearance} size={28} />
                  <span className={s.categoryChoiceLabel}>
                    {choice.subcategory}
                  </span>
                  {choice.key === selected && (
                    <Check size={16} aria-hidden="true" />
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
        {choices.length === 0 && (
          <output className={s.categoryNoResults}>
            No categories found. Try another name.
          </output>
        )}
      </div>
    </Sheet>
  );
}
