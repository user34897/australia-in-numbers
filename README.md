# Australia in numbers

A family dashboard of prices, wages, jobs, housing and population across Australia. The figures come from the Australian Bureau of Statistics (ABS) and are collected automatically every day.

## What's in this project

- `site/` is the website itself (the page, its styles and its code).
- `site/data/abs.json` holds the latest ABS figures. It's created and updated automatically, so you never edit it.
- `scripts/` collects the figures from the ABS. `indicators.mjs` lists which figures the site uses.
- `setup/update-data.yml` is the instruction file that tells GitHub to run the collection daily and publish the site. During setup you copy it to `.github/workflows/update-data.yml`.

## Setting it up

1. Create a free GitHub account at github.com.
2. Create a new **public** repository (the green "New" button). Tick "Add a README file" so it isn't empty.
3. In the repository, choose **Add file → Upload files**, then drag in the `scripts`, `site` and `setup` folders and this README. Click **Commit changes**.
4. Go to **Settings → Pages**. Under "Build and deployment", set **Source** to **GitHub Actions**.
5. Choose **Add file → Create new file**. Name it exactly `.github/workflows/update-data.yml` (typing the slashes creates the folders). Open `setup/update-data.yml`, copy everything in it, paste it in, and click **Commit changes**.
6. Open the **Actions** tab. A run called "Update ABS data and publish site" will start. It takes a few minutes. When it shows a green tick, your site's address appears under **Settings → Pages**.

From then on it runs by itself every day.

## If something goes wrong

**The run has a red cross.** Click into it, open the step that failed, and copy the lines that say FAILED. Those messages say exactly which figure couldn't be collected and why.

**A chart says some figures haven't come through.** One ABS dataset didn't load. The rest of the site still works. Open "About the data" at the bottom of the site to see which one and the reason.

**The "Save the figures" step fails with a permission error.** Go to **Settings → Actions → General → Workflow permissions**, choose **Read and write permissions**, save, then re-run.

**It stopped updating after a couple of months.** GitHub pauses daily runs on projects with no activity for 60 days. The daily data saves normally count as activity, but if it's ever paused, the Actions tab shows a button to turn it back on.

**Run it now instead of waiting.** Actions tab → "Update ABS data and publish site" → **Run workflow**.

## Source

Based on ABS data, licensed under Creative Commons Attribution 4.0.
