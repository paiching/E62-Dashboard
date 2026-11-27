import { CommonModule } from "@angular/common";
import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatIconModule } from "@angular/material/icon";
import type { ViewKey } from "./dashboard.model";
import {
  HELP_CHANGELOG,
  HELP_CHAPTERS,
  HELP_UPDATED,
  HelpChapter,
} from "./help-content";
import { MaterialSvgIconDirective } from "./material-icons";

/** Manual-style help page: chapter list, search, and links into each page. */
@Component({
  selector: "app-help-center",
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MaterialSvgIconDirective],
  templateUrl: "./help-center.component.html",
})
export class HelpCenterComponent implements OnChanges {
  @Input() chapterId = "start";
  @Input() permissions: string[] = [];
  /** Views the signed-in account may open. */
  @Input() views: ViewKey[] = [];
  @Input() noAccess = false;
  @Output() chapterIdChange = new EventEmitter<string>();
  @Output() openView = new EventEmitter<ViewKey>();
  @Output() startTour = new EventEmitter<HelpChapter>();

  readonly chapters = HELP_CHAPTERS;
  readonly changelog = HELP_CHANGELOG;
  readonly updated = HELP_UPDATED;
  query = "";
  showChangelog = false;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes["chapterId"]) this.showChangelog = false;
  }

  get chapter(): HelpChapter {
    return (
      this.chapters.find((item) => item.id === this.chapterId) ??
      this.chapters[0]
    );
  }
  get visibleChapters(): HelpChapter[] {
    const words = this.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return this.chapters;
    return this.chapters.filter((chapter) => {
      const text = chapterText(chapter).toLowerCase();
      return words.every((word) => text.includes(word));
    });
  }
  get chapterIndex(): number {
    return this.chapters.indexOf(this.chapter);
  }
  get previous(): HelpChapter | null {
    return this.chapters[this.chapterIndex - 1] ?? null;
  }
  get next(): HelpChapter | null {
    return this.chapters[this.chapterIndex + 1] ?? null;
  }
  allowed(chapter: HelpChapter): boolean {
    return !chapter.permission || this.permissions.includes(chapter.permission);
  }
  canOpen(chapter: HelpChapter): boolean {
    return Boolean(
      chapter.view &&
        this.allowed(chapter) &&
        this.views.includes(chapter.view),
    );
  }
  tourSteps(chapter: HelpChapter): number {
    return (chapter.tour ?? []).filter(
      (step) =>
        (!step.permission || this.permissions.includes(step.permission)) &&
        (!step.view || this.views.includes(step.view)),
    ).length;
  }
  select(chapter: HelpChapter): void {
    this.showChangelog = false;
    if (chapter.id === this.chapterId) return;
    this.chapterId = chapter.id;
    this.chapterIdChange.emit(chapter.id);
    document
      .querySelector(".help-article")
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  }
  openChangelog(): void {
    this.showChangelog = true;
  }
}

export function chapterText(chapter: HelpChapter): string {
  return [
    chapter.title,
    chapter.summary,
    ...chapter.sections.flatMap((section) => [
      section.heading,
      section.text ?? "",
      ...(section.steps ?? []),
      ...(section.bullets ?? []),
      section.tip ?? "",
    ]),
  ].join(" ");
}
