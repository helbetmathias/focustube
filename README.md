# FocusTube

FocusTube is a modern, privacy-first, and distraction-free YouTube client built for people who want to watch videos without falling down the rabbit hole.

It strips away comments, shorts, clickbait sidebars, and trackers, leaving you with a sleek, beautiful, and intentional viewing experience.

## ✨ Key Features

- **Built-in SponsorBlock**: Automatically skips in-video sponsor segments, long intros, and annoying outros using the community-driven SponsorBlock API.
- **100% Local Privacy**: Your watch history, preferences, and tracking never leave your machine. Everything is stored securely inside your browser's local IndexedDB. No Google account required.
- **Smart Hybrid Recommendations**: The home feed doesn't trap you in a filter bubble. It uses a custom algorithm that perfectly blends the newest uploads from your favorite creators with brand new serendipitous discoveries.
- **Distraction-Free UI**: No comments, no infinite scrolling, no algorithmic manipulation. Just the content you actively choose to engage with.
- **Ad-Free Playback**: Uses YouTube's official privacy-enhanced mode (`youtube-nocookie`) combined with a custom player interface.

## 🚀 Tech Stack

- **Frontend**: React, Vite, Tailwind CSS
- **Icons**: Lucide React
- **APIs**: Invidious API (for search & recommendations), SponsorBlock API (for segment skipping), YouTube Iframe API (for playback)
- **Storage**: IndexedDB (LocalForage)

## 🛠️ Getting Started

To run FocusTube locally on your machine:

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/focustube.git
   cd focustube
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

### Development Mode
To run the app in development mode (with hot-reloading, but slower performance):
```bash
npm run dev
```
Open your browser and navigate to `http://localhost:5173`

### Production Mode (Lightning Fast)
To experience the blazing-fast speeds of the final product locally, compile and preview the production build:
```bash
npm run build
npm run preview
```
Open your browser and navigate to the preview URL provided (usually `http://localhost:4173`).

## 🔒 Privacy Note
FocusTube acts entirely on the client side. There is no central server tracking your watch habits. Recommendations are fetched pseudonymously by querying public Invidious API instances.
