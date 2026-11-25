import {
  AfterViewInit,
  Directive,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  Output,
} from "@angular/core";

const DRAG_THRESHOLD = 4;
const SCROLL_EDGE = 70;
const SCROLL_STEP = 14;

interface Drag {
  card: HTMLElement;
  pointerId: number;
  startX: number;
  startY: number;
  clientX: number;
  clientY: number;
  /** Where inside the card it was grabbed. */
  grabX: number;
  grabY: number;
  active: boolean;
  before: HTMLElement[][];
  frame: number;
}

/**
 * Packs [data-card] children of a CSS grid Pinterest-style, so every vertical
 * gap equals the horizontal one, and lets them be rearranged by dragging their
 * icon or with the arrow keys on it. The grid's own columns decide the column
 * count. Children marked data-masonry-full go last, full width.
 *
 * A card keeps its column while only heights change, so a status message
 * appearing inside one card never makes others jump sideways.
 */
@Directive({ selector: "[appMasonry]", standalone: true })
export class MasonryDirective implements AfterViewInit, OnChanges, OnDestroy {
  /** Card ids per column, as last emitted; undefined packs automatically. */
  @Input("appMasonry") saved?: string[][];
  @Output() readonly arranged = new EventEmitter<string[][]>();

  private columns: HTMLElement[][] = [];
  private full: HTMLElement[] = [];
  private readonly heights = new Map<HTMLElement, number>();
  private readonly slots = new Map<HTMLElement, { x: number; y: number }>();
  private columnStep = 0;
  private gap = 0;
  private drag?: Drag;
  // Only children are observed: a width change always resizes them too, and
  // observing the grid would retrigger on the height set by place().
  private readonly resize = new ResizeObserver(() => this.layout());
  private readonly mutation = new MutationObserver(() => this.collect());
  private ready = false;

  constructor(
    private readonly host: ElementRef<HTMLElement>,
    private readonly zone: NgZone,
  ) {}

  private get grid(): HTMLElement {
    return this.host.nativeElement;
  }

  ngAfterViewInit(): void {
    this.ready = true;
    this.zone.runOutsideAngular(() => {
      this.grid.addEventListener("pointerdown", this.onPointerDown);
      this.grid.addEventListener("keydown", this.onKeydown);
      this.mutation.observe(this.grid, { childList: true });
    });
    this.collect();
  }
  ngOnChanges(): void {
    // Children for a newly selected tab are rendered after inputs are set.
    if (this.ready)
      this.zone.runOutsideAngular(() =>
        queueMicrotask(() => this.collect(true)),
      );
  }
  ngOnDestroy(): void {
    this.ready = false;
    this.endDrag(false);
    this.mutation.disconnect();
    this.resize.disconnect();
    this.grid.removeEventListener("pointerdown", this.onPointerDown);
    this.grid.removeEventListener("keydown", this.onKeydown);
  }

  private collect(rebuild = false): void {
    if (!this.ready) return;
    const children = Array.from(this.grid.children) as HTMLElement[];
    const cards = children.filter((child) => child.dataset["card"]);
    this.full = children.filter((child) =>
      child.hasAttribute("data-masonry-full"),
    );
    const known = new Set(this.columns.flat());
    const same =
      known.size === cards.length && cards.every((card) => known.has(card));
    if (!same) this.endDrag(false);
    this.resize.disconnect();
    for (const card of cards) this.setUpHandle(card);
    for (const child of [...cards, ...this.full]) this.resize.observe(child);
    if (!same || (rebuild && !this.drag)) this.columns = [];
    this.layout();
  }

  private setUpHandle(card: HTMLElement): void {
    const icon = card.querySelector<HTMLElement>(":scope > span");
    if (!icon || icon.classList.contains("card-drag-handle")) return;
    const title = card.querySelector("h3")?.textContent?.trim() ?? "";
    icon.classList.add("card-drag-handle");
    icon.tabIndex = 0;
    icon.title = "拖拉移動卡片（或用方向鍵）";
    icon.setAttribute("role", "button");
    icon.setAttribute("aria-label", `移動卡片：${title}，可用方向鍵`);
  }

  private layout(): void {
    const grid = this.grid;
    const placed = [...this.columns.flat(), ...this.full];
    // Holding the height keeps the scrollbar and scroll position steady while
    // cards are unplaced to count columns (placed ones could add implicit ones).
    grid.style.minHeight = `${grid.offsetHeight}px`;
    for (const card of placed) card.style.gridArea = "";
    const style = getComputedStyle(grid);
    const tracks = style.gridTemplateColumns.split(" ");
    this.gap = parseFloat(style.columnGap) || 0;
    this.columnStep = (parseFloat(tracks[0]) || 0) + this.gap;
    const cards = (Array.from(grid.children) as HTMLElement[]).filter(
      (child) => child.dataset["card"],
    );
    for (const card of [...cards, ...this.full])
      this.heights.set(card, Math.ceil(card.getBoundingClientRect().height));
    if (tracks.length !== this.columns.length) {
      this.endDrag(false);
      this.columns = this.arrange(cards, tracks.length);
    }
    this.place(false);
    grid.style.minHeight = "";
  }

  private arrange(cards: HTMLElement[], count: number): HTMLElement[][] {
    const columns: HTMLElement[][] = Array.from({ length: count }, () => []);
    const bottoms = new Array<number>(count).fill(0);
    const left = new Map(cards.map((card) => [card.dataset["card"]!, card]));
    const add = (card: HTMLElement, column: number) => {
      columns[column].push(card);
      bottoms[column] += this.heights.get(card)! + this.gap;
      left.delete(card.dataset["card"]!);
    };
    const saved = this.saved ?? [];
    if (saved.length === count)
      saved.forEach((ids, column) => {
        for (const id of ids) if (left.has(id)) add(left.get(id)!, column);
      });
    // Arranged at another width: keep the reading order, row by row.
    const rows = Math.max(0, ...saved.map((ids) => ids.length));
    const order: string[] = [];
    for (let row = 0; row < rows; row++)
      for (const ids of saved) if (ids[row]) order.push(ids[row]);
    for (const id of [...order, ...left.keys()])
      if (left.has(id)) add(left.get(id)!, bottoms.indexOf(Math.min(...bottoms)));
    return columns;
  }

  private place(animate: boolean): void {
    const bottoms = this.columns.map((cards, column) =>
      cards.reduce((y, card) => {
        this.put(card, `${column + 1}`, column * this.columnStep, y, animate);
        return y + this.heights.get(card)! + this.gap;
      }, 0),
    );
    let bottom = Math.max(0, ...bottoms);
    for (const item of this.full) {
      this.put(item, "1 / -1", 0, bottom, animate);
      bottom += this.heights.get(item)! + this.gap;
    }
  }

  private put(
    card: HTMLElement,
    column: string,
    x: number,
    y: number,
    animate: boolean,
  ): void {
    const old = this.slots.get(card);
    this.slots.set(card, { x, y });
    card.style.gridRow = `${y + 1} / span ${this.heights.get(card)}`;
    card.style.gridColumn = column;
    if (
      animate &&
      old &&
      (old.x !== x || old.y !== y) &&
      !(this.drag?.active && this.drag.card === card)
    )
      this.slide(card, old.x - x, old.y - y);
  }

  private slide(card: HTMLElement, dx: number, dy: number): void {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    card.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
      { duration: 160, easing: "ease-out" },
    );
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.drag || event.button !== 0) return;
    const target = event.target as Element;
    const card = target.closest<HTMLElement>("[data-card]");
    const handle = target.closest<HTMLElement>(".card-drag-handle");
    if (!card || !handle) return;
    event.preventDefault();
    handle.focus({ preventScroll: true });
    const rect = card.getBoundingClientRect();
    this.drag = {
      card,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      clientX: event.clientX,
      clientY: event.clientY,
      grabX: event.clientX - rect.left,
      grabY: event.clientY - rect.top,
      active: false,
      before: this.columns.map((cards) => [...cards]),
      frame: 0,
    };
    addEventListener("pointermove", this.onPointerMove);
    addEventListener("pointerup", this.onPointerEnd);
    addEventListener("pointercancel", this.onPointerEnd);
    addEventListener("keydown", this.onEscape, true);
    addEventListener("scroll", this.onScroll, true);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.clientX = event.clientX;
    drag.clientY = event.clientY;
    if (!drag.active) {
      if (
        Math.hypot(drag.clientX - drag.startX, drag.clientY - drag.startY) <
        DRAG_THRESHOLD
      )
        return;
      drag.active = true;
      drag.card.classList.add("is-dragging");
      this.grid.classList.add("is-arranging");
      this.autoScroll();
    }
    this.followPointer();
  };

  private readonly onScroll = (): void => {
    if (this.drag?.active) this.followPointer();
  };

  private followPointer(): void {
    const drag = this.drag!;
    const rect = this.grid.getBoundingClientRect();
    const x = drag.clientX - rect.left;
    const y = drag.clientY - rect.top;
    const column = Math.max(
      0,
      Math.min(this.columns.length - 1, Math.floor(x / this.columnStep)),
    );
    // Compared against the column without the dragged card, so the target
    // depends only on the pointer and cannot flicker as cards make room.
    let top = 0;
    let index = 0;
    for (const card of this.columns[column]) {
      if (card === drag.card) continue;
      const height = this.heights.get(card)!;
      if (top + height / 2 > y) break;
      top += height + this.gap;
      index++;
    }
    this.move(drag.card, column, index);
    const slot = this.slots.get(drag.card)!;
    drag.card.style.transform = `translate(${x - drag.grabX - slot.x}px, ${y - drag.grabY - slot.y}px)`;
  }

  private autoScroll(): void {
    const drag = this.drag;
    if (!drag?.active) return;
    if (drag.clientY < SCROLL_EDGE) scrollBy(0, -SCROLL_STEP);
    else if (drag.clientY > innerHeight - SCROLL_EDGE) scrollBy(0, SCROLL_STEP);
    drag.frame = requestAnimationFrame(() => this.autoScroll());
  }

  private readonly onPointerEnd = (event: PointerEvent): void => {
    if (event.pointerId === this.drag?.pointerId)
      this.endDrag(event.type === "pointerup");
  };
  private readonly onEscape = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    this.endDrag(false);
  };

  private endDrag(keep: boolean): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = undefined;
    cancelAnimationFrame(drag.frame);
    removeEventListener("pointermove", this.onPointerMove);
    removeEventListener("pointerup", this.onPointerEnd);
    removeEventListener("pointercancel", this.onPointerEnd);
    removeEventListener("keydown", this.onEscape, true);
    removeEventListener("scroll", this.onScroll, true);
    if (!drag.active) return;
    const from = drag.card.getBoundingClientRect();
    drag.card.style.transform = "";
    drag.card.classList.remove("is-dragging");
    this.grid.classList.remove("is-arranging");
    if (!keep) {
      this.columns = drag.before;
      this.place(true);
    }
    const to = drag.card.getBoundingClientRect();
    this.slide(drag.card, from.left - to.left, from.top - to.top);
    if (keep && !this.equals(drag.before)) this.emit();
  }

  private readonly onKeydown = (event: KeyboardEvent): void => {
    const handle = (event.target as Element).closest(".card-drag-handle");
    const card = handle?.closest<HTMLElement>("[data-card]");
    if (!card || this.drag) return;
    const column = this.columns.findIndex((cards) => cards.includes(card));
    if (column < 0) return;
    const index = this.columns[column].indexOf(card);
    const targets: Record<string, [number, number]> = {
      ArrowUp: [column, index - 1],
      ArrowDown: [column, index + 1],
      ArrowLeft: [column - 1, index],
      ArrowRight: [column + 1, index],
    };
    const target = targets[event.key];
    if (!target) return;
    event.preventDefault();
    const before = this.columns.map((cards) => [...cards]);
    this.move(card, ...target);
    if (this.equals(before)) return;
    card.scrollIntoView({ block: "nearest" });
    this.emit();
  };

  private move(card: HTMLElement, column: number, index: number): void {
    if (!this.columns[column] || index < 0) return;
    const next = this.columns.map((cards) =>
      cards.filter((other) => other !== card),
    );
    next[column].splice(index, 0, card);
    if (this.equals(next)) return;
    this.columns = next;
    this.place(true);
  }

  private equals(other: HTMLElement[][]): boolean {
    return (
      other.length === this.columns.length &&
      this.columns.every(
        (cards, column) =>
          cards.length === other[column].length &&
          cards.every((card, index) => card === other[column][index]),
      )
    );
  }

  private emit(): void {
    const ids = this.columns.map((cards) =>
      cards.map((card) => card.dataset["card"]!),
    );
    this.zone.run(() => this.arranged.emit(ids));
  }
}
