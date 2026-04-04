name: Refresh Job Data

on:
  schedule:
    - cron: '0 6 * * *'
  workflow_dispatch:

jobs:
  refresh:
    runs-on: ubuntu-latest
    timeout-minutes: 15

    steps:
      - name: Checkout repo
        uses: actions/checkout@v4
        with:
          ref: main
          fetch-depth: 1

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm install @vercel/blob

      - name: Fetch and upload job data
        env:
          RAPIDAPI_KEY: ${{ secrets.RAPIDAPI_KEY }}
          BLOB_READ_WRITE_TOKEN: ${{ secrets.BLOB_READ_WRITE_TOKEN }}
        run: node scripts/refresh-jobs.js