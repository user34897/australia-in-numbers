// Which ABS series the site collects.
//
// Each indicator names an ABS dataflow and either:
//   key    — an exact series key (codes separated by dots), confirmed to work, and/or
//   select — a description of the series by its labels, which the fetch script
//            turns into a key by reading the dataflow's structure from the ABS.
// If `key` fails and `select` exists, the script falls back to `select`.
//
// seriesBy names the dimension that splits the result into several lines
// (for example REGION for one line per state).

const STATES = '1+2+3+4+5+6+7+8';

const STATE_LABELS = [
  /^new south wales$/, /^victoria$/, /^queensland$/, /^south australia$/,
  /^western australia$/, /^tasmania$/, /^northern territory$/, /^australian capital territory$/,
];

const LF_BASE = {
  SEX: { codes: ['3'] },
  AGE: { codes: ['1599'] },
  TSEST: { codes: ['20'] },
  REGION: { codes: ['AUS'] },
  FREQ: { codes: ['M'] },
};

export const INDICATORS = [
  // ---------- Prices ----------
  {
    id: 'cpi_m',
    title: 'Consumer Price Index, all groups, monthly',
    flow: 'CPI', key: '1.10001.10.50.M', start: '2024-01',
    release: 'Consumer Price Index, Australia',
  },
  {
    id: 'cpi_q',
    title: 'Consumer Price Index, all groups, quarterly',
    flow: 'CPI', key: '1.10001.10.50.Q', start: '1995-Q1',
    release: 'Consumer Price Index, Australia',
  },
  {
    id: 'rents_q',
    title: 'Consumer Price Index, rents, quarterly',
    flow: 'CPI', key: '1.30014.10.50.Q', start: '2000-Q1',
    release: 'Consumer Price Index, Australia',
  },
  {
    id: 'cpi_cities',
    title: 'Consumer Price Index by capital city',
    flow: 'CPI', key: `1.10001.10.${STATES}.Q`, start: '2021-Q1', seriesBy: 'REGION',
    release: 'Consumer Price Index, Australia',
  },
  {
    id: 'cpi_items',
    title: 'Consumer Price Index by spending category, monthly',
    flow: 'CPI', start: '2024-01', seriesBy: 'INDEX',
    release: 'Consumer Price Index, Australia',
    select: {
      MEASURE: { codes: ['1'] },
      TSEST: { codes: ['10'] },
      REGION: { codes: ['50'] },
      FREQ: { codes: ['M'] },
      INDEX: {
        labels: [
          /^food and non-alcoholic beverages$/,
          /^alcohol and tobacco$/,
          /^clothing and footwear$/,
          /^rents$/,
          /^new dwelling purchase by owner-occupiers$/,
          /^electricity$/,
          /^gas and other household fuels$/,
          /^automotive fuel$/,
          /^health$/,
          /^education$/,
          /^insurance$/,
          /^communication$/,
          /^recreation and culture$/,
          /^meals out and take away foods$/,
          /^furnishings, household equipment and services$/,
        ],
      },
    },
  },

  // ---------- Wages ----------
  {
    id: 'wpi',
    title: 'Wage Price Index, total hourly rates of pay excluding bonuses',
    flow: 'WPI', key: '1.THRPEB.7.TOT.10.AUS.Q', start: '1998-Q1',
    release: 'Wage Price Index, Australia',
  },
  {
    id: 'wpi_states',
    title: 'Wage Price Index by state',
    flow: 'WPI', key: `1.THRPEB.7.TOT.10.${STATES}.Q`, start: '2021-Q1', seriesBy: 'REGION',
    release: 'Wage Price Index, Australia',
  },

  // ---------- Jobs ----------
  {
    id: 'unemp',
    title: 'Unemployment rate, seasonally adjusted',
    flow: 'LF', key: 'M13.3.1599.20.AUS.M', start: '2000-01',
    release: 'Labour Force, Australia',
  },
  {
    id: 'unemp_youth',
    title: 'Unemployment rate, 15–24 year olds, seasonally adjusted',
    // Age groups aren't in the main LF dataflow; they're published in LF_AGES.
    flow: 'LF_AGES', key: 'M13.3.1524.20.AUS.M', start: '2000-01',
    release: 'Labour Force, Australia',
    select: { ...LF_BASE, MEASURE: { codes: ['M13'] }, AGE: { labels: [/^15\s*-\s*24 years$/, /15.{0,3}24/] } },
  },
  {
    id: 'participation',
    title: 'Participation rate, seasonally adjusted',
    flow: 'LF', key: 'M12.3.1599.20.AUS.M', start: '2000-01',
    release: 'Labour Force, Australia',
    select: { ...LF_BASE, MEASURE: { labels: [/^participation rate$/, /participation rate/] } },
  },
  {
    id: 'underemp',
    title: 'Underemployment rate, seasonally adjusted',
    flow: 'LF_UNDER', key: 'M23.3.1599.20.AUS.M', start: '2000-01',
    release: 'Labour Force, Australia',
  },
  {
    id: 'unemp_states',
    title: 'Unemployment rate by state, seasonally adjusted (trend for NT and ACT)',
    // The ABS publishes no seasonally adjusted series for NT and ACT, only trend.
    // Asking for both lets pickSeries use seasonally adjusted where it exists.
    flow: 'LF', start: '2023-01', seriesBy: 'REGION',
    release: 'Labour Force, Australia',
    select: { ...LF_BASE, MEASURE: { codes: ['M13'] }, TSEST: { codes: ['20', '30'] }, REGION: { labels: STATE_LABELS } },
  },
  {
    id: 'ft_pt',
    title: 'Employed people, full-time and part-time, seasonally adjusted',
    flow: 'LF', start: '2000-01', seriesBy: 'MEASURE',
    release: 'Labour Force, Australia',
    select: { ...LF_BASE, MEASURE: { labels: [/^employed\s*-?\s*full-time$/, /^employed\s*-?\s*part-time$/] } },
  },
  {
    id: 'vacancies',
    title: 'Job vacancies, seasonally adjusted',
    flow: 'JV', start: '2005-Q1',
    release: 'Job Vacancies, Australia',
    select: {
      REGION: { labels: [/^australia$/] },
      TSEST: { labels: [/^seasonally adjusted$/] },
      FREQ: { codes: ['Q'] },
    },
  },

  // ---------- People ----------
  {
    id: 'population',
    title: 'Population and where growth comes from',
    flow: 'ERP_COMP_Q', start: '2000-Q1', seriesBy: 'MEASURE',
    release: 'National, state and territory population',
    select: {
      MEASURE: {
        labels: [/^estimated resident population$/, /^natural increase$/, /^net overseas migration$/],
      },
      REGION: { labels: [/^australia$/] },
      FREQ: { codes: ['Q'] },
    },
  },
  {
    id: 'population_states',
    title: 'Population by state',
    flow: 'ERP_COMP_Q', start: '2021-Q1', seriesBy: 'REGION',
    release: 'National, state and territory population',
    select: {
      MEASURE: { labels: [/^estimated resident population$/] },
      REGION: { labels: STATE_LABELS },
      FREQ: { codes: ['Q'] },
    },
  },

  // ---------- Housing ----------
  {
    id: 'approvals',
    title: 'New homes approved (dwelling units), original',
    // BA_GCCSA only carries original (unadjusted) figures. The site shows a
    // 12-month average and 12-month total, which smooth out seasonality anyway.
    flow: 'BA_GCCSA', flowSearch: /building approvals/, start: '2005-01',
    release: 'Building Approvals, Australia',
    select: {
      MEASURE: { labels: [/^number of dwelling units$/, /dwelling units/] },
      VALUE: { labels: [/^total$/] },
      SECTOR: { labels: [/^total sectors$/] },
      WORK_TYPE: { labels: [/^total work$/] },
      BUILDING_TYPE: { labels: [/^total$/] },
      REGION: { labels: [/^australia$/, /^total australia$/] },
      TSEST: { labels: [/^original$/] },
      FREQ: { codes: ['M'] },
    },
  },
];
