import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider, CssBaseline } from '@mui/material';
import theme from './theme';
import Layout from './components/Layout';
import Home from './pages/Home';
import AssetDetail from './pages/AssetDetail';
import TrackRecord from './pages/TrackRecord';

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Home />} />
            <Route path="/asset/:assetId" element={<AssetDetail />} />
            <Route path="/track-record" element={<TrackRecord />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}
