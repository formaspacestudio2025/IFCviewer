// src/custom-elements.d.ts
import * as React from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "bim-panel": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & { label?: string };

      "bim-panel-section": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & { label?: string };

      "bui-properties-table": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & {
        items?: Record<string, any>;
        expanded?: boolean;
        queryString?: string | null;
        tsv?: string;
        requestUpdate?: () => void;
      };
    }
  }
}

export {};