import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type {
  IChartApiBase,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  PrimitivePaneViewZOrder,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from "lightweight-charts";

export interface BandRangePoint {
  time: Time;
  upper: number;
  lower: number;
}

class BandFillRenderer implements IPrimitivePaneRenderer {
  private readonly points: ReadonlyArray<{ x: number; yUpper: number; yLower: number }>;
  private readonly fillStyle: string;

  constructor(points: ReadonlyArray<{ x: number; yUpper: number; yLower: number }>, fillStyle: string) {
    this.points = points;
    this.fillStyle = fillStyle;
  }

  draw(target: CanvasRenderingTarget2D): void {
    if (this.points.length < 2) return;
    target.useMediaCoordinateSpace(({ context }) => {
      context.save();
      context.beginPath();
      context.moveTo(this.points[0].x, this.points[0].yUpper);
      for (let i = 1; i < this.points.length; i++) {
        context.lineTo(this.points[i].x, this.points[i].yUpper);
      }
      for (let i = this.points.length - 1; i >= 0; i--) {
        context.lineTo(this.points[i].x, this.points[i].yLower);
      }
      context.closePath();
      context.fillStyle = this.fillStyle;
      context.fill();
      context.restore();
    });
  }
}

class BandFillPaneView implements IPrimitivePaneView {
  private readonly owner: BandFillPrimitive;

  constructor(owner: BandFillPrimitive) {
    this.owner = owner;
  }

  zOrder(): PrimitivePaneViewZOrder {
    return "bottom";
  }

  renderer(): IPrimitivePaneRenderer | null {
    const coords = this.owner.computeScreenPoints();
    if (coords.length < 2) return null;
    return new BandFillRenderer(coords, this.owner.getFillStyle());
  }
}

export class BandFillPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private requestUpdate?: () => void;
  private points: BandRangePoint[] = [];
  private fillStyle: string;
  private readonly view: BandFillPaneView;

  constructor(fillStyle = "rgba(41, 98, 255, 0.08)") {
    this.fillStyle = fillStyle;
    this.view = new BandFillPaneView(this);
  }

  attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
    this.chart = param.chart;
    this.series = param.series;
    this.requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = undefined;
  }

  setData(points: BandRangePoint[], fillStyle?: string): void {
    this.points = points;
    if (fillStyle !== undefined) this.fillStyle = fillStyle;
    this.requestUpdate?.();
  }

  getFillStyle(): string {
    return this.fillStyle;
  }

  updateAllViews(): void {
    // Coordinates are resolved dynamically in paneViews()->renderer() on paint
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view];
  }

  computeScreenPoints(): Array<{ x: number; yUpper: number; yLower: number }> {
    if (!this.chart || !this.series || this.points.length < 2) return [];
    const timeScale = this.chart.timeScale();
    const out: Array<{ x: number; yUpper: number; yLower: number }> = [];
    for (const pt of this.points) {
      const x = timeScale.timeToCoordinate(pt.time);
      const yUpper = this.series.priceToCoordinate(pt.upper);
      const yLower = this.series.priceToCoordinate(pt.lower);
      if (x !== null && yUpper !== null && yLower !== null) {
        out.push({ x, yUpper, yLower });
      }
    }
    return out;
  }
}
