// routes/cep.js
import express from 'express';
import axios from 'axios';
const router = express.Router();

router.get('/api/cep/:cep', async (req, res) => {
  // Só dígitos: evita injeção de path/query na URL do ViaCEP.
  const cep = String(req.params.cep || '').replace(/\D/g, '');
  if (cep.length !== 8) {
    return res.status(400).json({ error: 'CEP inválido' });
  }
  try {
    const { data } = await axios.get(`https://viacep.com.br/ws/${cep}/json/`, { timeout: 8000 });
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Falha na consulta de CEP' });
  }
});

export default router;
