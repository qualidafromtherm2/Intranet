// routes/cep.js
import express from 'express';
import axios from 'axios';
const router = express.Router();

router.get('/api/cep/:cep', async (req, res) => {
  try {
    const { data } = await axios.get(`https://viacep.com.br/ws/${req.params.cep}/json/`);
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Falha na consulta de CEP' });
  }
});

export default router;
