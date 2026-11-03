You are an AI assistant tasked with generating a **complete slide deck** based strictly on the provided press release. The slides should clearly explain the financial results to media, the general public, and non-specialist audiences. You must use **only the information explicitly contained in the press release**.

The slides should help the audience:

* Quickly understand **overall performance**
* Grasp **key financial numbers and growth drivers**
* Correctly interpret **GAAP vs non-GAAP figures**
* Understand **business segment performance**
* Avoid misinterpretation or over-analysis

---

# Strict Constraints

Below are the **hard constraints** you MUST satisfy. Slides violating these constraints are considered **incorrect**.

## 1. Content Structure

The slide deck must contain **15–20 slides**.

The slide deck must include the following sections, in the order listed below (the number of slides in each section may be determined as appropriate).

1. Title & Overview

* **Title Slide**: Must include the company name (JPMorgan Chase & Co.), fiscal period (3Q21), date (October 13, 2021), and a sub-header summarizing the main sentiment (e.g., "Strong Results Amid Economic Growth").
* **Executive Summary**: A high-level bulleted list of the top-line figures: Net Income, Earnings Per Share (EPS), and Revenue (Reported vs Managed). Include the Reserve Release impact.

2. Leadership Context

* **Management Commentary**: Select key quotes from Jamie Dimon regarding "economic growth," the "Delta variant/supply chain," and the nature of the "credit reserve releases" (specifically that they are not considered core/recurring profits).
* **Purpose**: To provide the strategic narrative driving the financial results and caution regarding volatility.

3. Financial Deep Dive

* **Income Statement Highlights**: A detailed comparison of Net Revenue (Managed), Noninterest Expense, Provision for Credit Losses, and Net Income compared to 3Q20.
* **Significant Items (Non-Core)**: A dedicated slide explaining the **$2.1 billion net credit reserve release** and the **$566 million income tax benefit**.
* **Requirement**: Explicitly state the EPS impact of these items ($0.52 and $0.19 respectively) and present the "Excluding significant items" Net Income ($9.6B) to prevent audience misinterpretation of core earnings.
* **Capital & Fortress Principles**: Detail the return of capital (Dividends of $3.0B, Net Repurchases of $5.0B) and key capital ratios (Basel III CET1, SLR).

4. Segment Performance

    * **Consumer & Community Banking (CCB)**:
      * Show Net Revenue and Net Income changes.
      * Highlight specific drivers: Debit/Credit card sales volume (+26%), Home Lending originations, and the impact of lower card balances.
    * **Corporate & Investment Bank (CIB)**:
      * Show Net Revenue and Net Income changes.
      * List specific highlights: #1 Ranking in Global IB fees, IB revenue growth (+45%), and Markets revenue decline (-5%) due to Fixed Income normalization.
    * **Commercial Banking (CB)**:
      * Show Net Revenue and Net Income changes.
      * Highlight record Gross IB revenue and trends in loan demand (Commercial Real Estate).
    * **Asset & Wealth Management (AWM)**:
      * Show Net Revenue and Net Income changes.
      * Highlight Assets Under Management (AUM) growth to $3.0 trillion and loan growth.

5. Operational Highlights & Community Support

    * **Business Expansion**: Summarize the statement regarding branch expansion (first bank in all lower 48 states) and international digital retail launch (U.K.).
    * **Community Impact**: List metrics on credit and capital raised ($2.4 trillion YTD), including specific figures for consumers, small businesses, and corporations.

6. Closing & Disclaimers

    * **Forward-Looking Statements & Risks**: A summary slide noting that actual results may differ due to risks.
    * **Contact & Replay Info**: List the investor relations contact (Reggie Chambers) and media contact (Trish Wexler), along with conference call details.

## 2. Content Constraints

* **Faithfulness to background materials**: Use only the information in the material. You must not fabricate additional experiments or modify or reinterpret the authors' claims.
  * Specially, forward-looking statements:
    * Must be summarized neutrally
    * Must not be expanded or reinterpreted
  * Risk factors:
    * May be summarized as “The company notes standard forward-looking risks”
    * Do not list or elaborate unless the press release itself emphasizes them
* **Accuracy:** All content must be factually accurate, especially quantitative content and facts.
* **Brevity:** Use short, concise phrases, not long paragraphs. Focus on summarizing key facts and events without excessive detail. Bullet points may be used for clarity. If you use bullet points, each slide should have no more than 6 bullet points.
* **Sufficient Depth**: Do not summarize the material in an overly superficial or high-level manner. The slides should preserve essential technical details, key arguments, and substantive insights rather than only presenting vague conclusions.
* **Logical Flow:** The slides should present a clear narrative, starting from early space exploration to recent developments. Ensure there is a clear progression of time and events.
* **Relevance of Information**: You must not add unrelated content.
* **Code & Markup Formatting**: Avoid raw LaTeX or Markdown code unless necessary.
* **Citation & Referencing**: Accurately reference the material's results, diagrams, and examples. 
   * If a slide uses data from the material, you must clearly indicate the source of the data on that slide (e.g., page xx, Figure xx, Table xx).
   * All references (if any) must be placed in the bottom-left corner of the slide.

## 3. Visual & Design

* **Images:** Include relevant images. Images must be high quality, clearly labeled, and relevant to the content.
* **Charts and Diagrams:** Use appropriate charts and diagrams where needed to visually present and clarify information, rather than relying only on text (and demos).
  * If the slide includes charts or figures, ensure that all visual elements are clearly annotated (e.g., axes are labeled, units are specified, legends are included where needed, and data points are explained when necessary).
  * Include **figures or diagrams descriptions** when appropriate, e.g., “The chart (from page 4 in the material) shows proprietary models outperform open-weight ones.”
* **Legibility:** Use legible fonts and avoid clutter. Text should be large enough to be easily read.
* **Visual Balance:** Balance text and visuals so slides are easy to read when projected.
* **Layout:** Maintain a clean, professional layout with appropriate fonts, colors, and formatting.
* **Style Consistency**: The entire slide deck should follow a unified and coherent visual style.
* **Information Load**: Slides should avoid excessive information per page to preserve readability.

## 4. Text Quality

* All generated text should be clear, with no missing or incorrect characters or words.
* Spelling, grammar, and typography must be accurate and correct throughout the content.

## 5. Technical Fidelity Requirements

* **Quantitative Coverage**: Ensure that key quantitative data (possibly presented in tables or charts in the material) are included in the slide deck. In other words, the presentation should not only discuss the ideas of the material but also present specific quantitative details (e.g., statistical data).
  * The slide deck must include at least 5 slides with quantitative details.

* **Numerical Exactness Rules**: All numbers must:
  * Match the press release **exactly**
  * Preserve units (billions, millions, etc.)
  * Preserve GAAP / non-GAAP labels
  * Growth rates must not be recomputed unless explicitly stated

* **Table & Chart Traceability and Annotation**: Ensure that any tables and charts in your slide deck are consistent with the material. Specifically, for every table and chart in the slides:
  * If it is directly copied from the material, clearly indicate on the slide which figure or table it corresponds to in the material (e.g., page X in the material).
  * If it is newly plotted based on data from the material, clearly specify which section of the material the data are taken from (e.g., page X). In addition, provide a clear explanation of the meaning of each legend item in the figure and each row and column in the table.
  * For charts, every axis, unit, and label must be explicit

* **Point-Level Accuracy for Plots**: If scatter plots, line charts or radar charts are used in the slide deck, ensure that every data point exactly matches the corresponding data point in the original figure from the material. Note that the values must be **precisely** the same, not just the shape of the graph.

* **Conceptual Illustration**: The slides may include data used only for conceptual illustration. However, if such data are included, you must clearly indicate on the corresponding slide which data are conceptual illustrations rather than factual data reported in the material.


## 5. Presentation Tone and Audience

* **Tone:** The tone should be informative, clear, neutral, and appropriate for a media audience. Avoid casual or informal conversational language. Also avoid academic phrasing, persuasive or promotional wording, and any expression of personal opinion or judgment. Maintain a consistent tone throughout the slide deck.
* **Audience:** The intended audience is identical to that of the earnings press release (media, journalists, and the general public). The slides must not assume professional financial, accounting, or investment expertise, and must avoid too many technical jargon.

