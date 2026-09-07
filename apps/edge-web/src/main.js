import '@fontsource/poppins/latin-400.css';
import '@fontsource/poppins/latin-500.css';
import '@fontsource/poppins/latin-600.css';
import '@fontsource/poppins/latin-700.css';
import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router.js';
import './styles.css';

createApp(App).use(router).mount('#app');
