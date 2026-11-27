import { CommonModule } from "@angular/common";
import {
  Component,
  EventEmitter,
  HostListener,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  Output,
} from "@angular/core";
import { MatIconModule } from "@angular/material/icon";
import type { HelpTourStep } from "./help-content";
import { MaterialSvgIconDirective } from "./material-icons";

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 6;
const POPOVER_WIDTH = 340;
const FIND_TIMEOUT_MS = 2000;

/**
 * Guided tour: asks the parent to show the right page for each step, then
 * spotlights the element and explains it. Steps whose element never appears
 * (for example a card the account cannot see) are skipped.
 */
@Component({
  selector: "app-help-tour",
  standalone: true,
  imports: [CommonModule, MatIconModule, MaterialSvgIconDirective],
  template: `
    <div class="help-tour" *ngIf="steps.length" role="dialog" aria-modal="true" [attr.aria-label]="title">
      <div class="help-tour-blocker" (click)="close()"></div>
      <div class="help-tour-spotlight" *ngIf="box" [style.top.px]="box.top" [style.left.px]="box.left" [style.width.px]="box.width" [style.height.px]="box.height"></div>
      <section class="help-tour-popover" [style.top.px]="popTop" [style.left.px]="popLeft" [class.is-loading]="!box">
        <header>
          <small>{{ title }} · {{ index + 1 }} / {{ steps.length }}</small>
          <button type="button" class="icon-button" (click)="close()" aria-label="結束導覽" title="結束導覽（Esc）"><mat-icon>close</mat-icon></button>
        </header>
        <ng-container *ngIf="box; else finding">
          <h3>{{ step.title }}</h3>
          <p>{{ step.text }}</p>
        </ng-container>
        <ng-template #finding><p>正在帶您前往…</p></ng-template>
        <div class="help-tour-dots" aria-hidden="true"><i *ngFor="let s of steps; let i = index" [class.active]="i === index"></i></div>
        <footer>
          <button type="button" class="secondary-button" (click)="go(-1)" [disabled]="index === 0"><mat-icon>arrow_back</mat-icon>上一步</button>
          <button type="button" class="primary-button" (click)="index === steps.length - 1 ? close() : go(1)">
            {{ index === steps.length - 1 ? "完成" : "下一步" }}<mat-icon *ngIf="index < steps.length - 1">arrow_forward</mat-icon>
          </button>
        </footer>
      </section>
    </div>
  `,
})
export class HelpTourComponent implements OnChanges, OnDestroy {
  @Input() steps: HelpTourStep[] = [];
  @Input() title = "互動導覽";
  /** Parent switches page / tab / dialog for the step before it is measured. */
  @Output() prepare = new EventEmitter<HelpTourStep>();
  @Output() closed = new EventEmitter<void>();

  index = 0;
  box: Box | null = null;
  popTop = 0;
  popLeft = 0;
  private element: HTMLElement | null = null;
  private frame = 0;
  private token = 0;

  constructor(private readonly zone: NgZone) {}

  get step(): HelpTourStep {
    return this.steps[this.index];
  }

  ngOnChanges(): void {
    if (this.steps.length) void this.show(0, 1);
    else this.stop();
  }
  ngOnDestroy(): void {
    this.stop();
  }

  @HostListener("document:keydown", ["$event"])
  onKey(event: KeyboardEvent): void {
    if (!this.steps.length) return;
    if (event.key === "Escape") this.close();
    else if (event.key === "ArrowRight" || event.key === "Enter")
      this.index === this.steps.length - 1 ? this.close() : this.go(1);
    else if (event.key === "ArrowLeft") this.go(-1);
    else return;
    event.preventDefault();
    event.stopPropagation();
  }

  go(direction: 1 | -1): void {
    const target = this.index + direction;
    if (target < 0 || target >= this.steps.length) return;
    void this.show(target, direction);
  }

  close(): void {
    this.stop();
    this.closed.emit();
  }

  private async show(target: number, direction: 1 | -1): Promise<void> {
    const token = ++this.token;
    this.index = target;
    this.box = null;
    this.element = null;
    this.placePopover();
    this.prepare.emit(this.steps[target]);
    const element = await this.find(this.steps[target].target, token);
    if (token !== this.token) return;
    if (!element) {
      const next = target + direction;
      if (next >= 0 && next < this.steps.length) return this.show(next, direction);
      if (direction === -1 && target > 0) return;
      // Nothing left to show in this direction: stay on a readable message.
      this.box = { top: innerHeight / 2, left: innerWidth / 2, width: 0, height: 0 };
      this.placePopover();
      return;
    }
    this.element = element;
    element.scrollIntoView({ block: "center", inline: "nearest" });
    this.measure();
    this.loop();
  }

  private find(selector: string, token: number): Promise<HTMLElement | null> {
    const started = Date.now();
    return new Promise((resolve) => {
      const check = () => {
        if (token !== this.token) return resolve(null);
        const element = document.querySelector<HTMLElement>(selector);
        if (element && element.getClientRects().length) return resolve(element);
        if (Date.now() - started > FIND_TIMEOUT_MS) return resolve(null);
        setTimeout(check, 80);
      };
      check();
    });
  }

  /** Follows the element while the page scrolls, resizes or re-renders. */
  private loop(): void {
    cancelAnimationFrame(this.frame);
    this.zone.runOutsideAngular(() => {
      const tick = () => {
        if (!this.element) return;
        const before = JSON.stringify(this.box);
        const after = this.rectOf(this.element);
        if (before !== JSON.stringify(after)) this.zone.run(() => this.measure());
        this.frame = requestAnimationFrame(tick);
      };
      this.frame = requestAnimationFrame(tick);
    });
  }

  private rectOf(element: HTMLElement): Box {
    const rect = element.getBoundingClientRect();
    const top = Math.max(rect.top - PAD, 4);
    const left = Math.max(rect.left - PAD, 4);
    return {
      top,
      left,
      width: Math.min(rect.width + PAD * 2, innerWidth - left - 4),
      height: Math.min(rect.bottom + PAD, innerHeight - 4) - top,
    };
  }

  private measure(): void {
    if (!this.element) return;
    this.box = this.rectOf(this.element);
    this.placePopover();
  }

  private placePopover(): void {
    const width = Math.min(POPOVER_WIDTH, innerWidth - 24);
    const height = 230;
    if (!this.box || !this.box.width) {
      this.popTop = Math.max((innerHeight - height) / 2, 12);
      this.popLeft = Math.max((innerWidth - width) / 2, 12);
      return;
    }
    const { top, left, width: w, height: h } = this.box;
    const below = top + h + 12;
    const above = top - height - 12;
    const right = left + w + 12;
    if (below + height < innerHeight) {
      this.popTop = below;
      this.popLeft = left;
    } else if (above > 8) {
      this.popTop = above;
      this.popLeft = left;
    } else if (right + width < innerWidth) {
      this.popTop = top;
      this.popLeft = right;
    } else {
      this.popTop = innerHeight - height - 12;
      this.popLeft = left;
    }
    this.popLeft = Math.min(Math.max(this.popLeft, 12), innerWidth - width - 12);
    this.popTop = Math.min(Math.max(this.popTop, 12), innerHeight - height - 12);
  }

  private stop(): void {
    this.token++;
    cancelAnimationFrame(this.frame);
    this.element = null;
    this.box = null;
  }
}
