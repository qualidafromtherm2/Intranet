var OMIE_APP_KEY = 'PUT_YOUR_APP_KEY_HERE';
var OMIE_APP_SECRET = 'PUT_YOUR_APP_SECRET_HERE';

var XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;
var CategoriasCadastroJsonClient=function(){
	this._EndPoint="https://app.omie.com.br/api/v1/geral/categorias/";
	this._Call=function(method,param,cb){
		var server= new XMLHttpRequest();
		server.open("POST",this._EndPoint,cb!=null);
		server.setRequestHeader("Content-Type","application/json");
		var req=JSON.stringify({call:method,app_key:OMIE_APP_KEY,app_secret:OMIE_APP_SECRET,param:(param)?param:[]});
		if(cb){
			server.onreadystatechange=this._EndCall;
			server.cb=cb;
			server.send(req);
			return server;
		}else{
			server.send(req);
			var res=JSON.parse(server.responseText);
			delete(server);
			return res;
		}
	};
	this._EndCall=function(e){
		var server=this;
		if(server.readyState!=4)
			return;
		if(server.status!=200)
			throw(new Exception("AJAX error "+server.status+": "+server.statusText));
		server.cb(JSON.parse(server.responseText));
		server.cb=null;
		delete(server);
	};
	this.ConsultarCategoria=function(
		categoria_consultar,
		_cb
	){
		return this._Call(
			"ConsultarCategoria",
			[
			categoria_consultar
			],
			(_cb)?_cb:null
		);
	};
	this.ListarCategorias=function(
		categoria_list_request,
		_cb
	){
		return this._Call(
			"ListarCategorias",
			[
			categoria_list_request
			],
			(_cb)?_cb:null
		);
	};
	this.IncluirCategoria=function(
		categoria_incluir,
		_cb
	){
		return this._Call(
			"IncluirCategoria",
			[
			categoria_incluir
			],
			(_cb)?_cb:null
		);
	};
	this.AlterarCategoria=function(
		categoria_alterar,
		_cb
	){
		return this._Call(
			"AlterarCategoria",
			[
			categoria_alterar
			],
			(_cb)?_cb:null
		);
	};
	this.IncluirGrupoCategoria=function(
		categoria_grupo_incluir,
		_cb
	){
		return this._Call(
			"IncluirGrupoCategoria",
			[
			categoria_grupo_incluir
			],
			(_cb)?_cb:null
		);
	};
	this.AlterarGrupoCategoria=function(
		categoria_grupo_alterar,
		_cb
	){
		return this._Call(
			"AlterarGrupoCategoria",
			[
			categoria_grupo_alterar
			],
			(_cb)?_cb:null
		);
	};
	this.categoria_alterar=function(){
		this.codigo=null;
		this.descricao=null;
		this.natureza=null;
		this.tipo_categoria=null;
		this.codigo_dre=null;
		this.conta_inativa=null;
	};
	this.categoria_cadastro=function(){
		this.codigo=null;
		this.descricao=null;
		this.descricao_padrao=null;
		this.tipo_categoria=null;
		this.conta_inativa=null;
		this.definida_pelo_usuario=null;
		this.id_conta_contabil=null;
		this.tag_conta_contabil=null;
		this.conta_despesa=null;
		this.conta_receita=null;
		this.nao_exibir=null;
		this.natureza=null;
		this.totalizadora=null;
		this.transferencia=null;
		this.codigo_dre=null;
		this.categoria_superior=null;
		this.dadosDRE=null;
	};
	this.dadosDRE=function(){
		this.codigoDRE=null;
		this.descricaoDRE=null;
		this.naoExibirDRE=null;
		this.nivelDRE=null;
		this.sinalDRE=null;
		this.totalizaDRE=null;
	};
	this.categoria_cadastro_response=function(){
		this.codigo_status=null;
		this.descricao_status=null;
		this.codigo=null;
	};
	this.categoria_consultar=function(){
		this.codigo=null;
	};
	this.categoria_grupo_alterar=function(){
		this.codigo=null;
		this.descricao=null;
		this.natureza=null;
	};
	this.categoria_grupo_incluir=function(){
		this.descricao=null;
		this.tipo_grupo=null;
		this.natureza=null;
	};
	this.categoria_inativar=function(){
		this.codigo=null;
	};
	this.categoria_incluir=function(){
		this.categoria_superior=null;
		this.descricao=null;
		this.natureza=null;
		this.tipo_categoria=null;
		this.codigo_dre=null;
	};
	this.categoria_list_request=function(){
		this.pagina=null;
		this.registros_por_pagina=null;
		this.apenas_importado_api=null;
		this.ordenar_por=null;
		this.ordem_descrescente=null;
		this.filtrar_apenas_ativo=null;
		this.filtrar_por_tipo=null;
	};
	this.categoria_listfull_response=function(){
		this.pagina=null;
		this.total_de_paginas=null;
		this.registros=null;
		this.total_de_registros=null;
		this.categoria_cadastro=null;
	};
	this.omie_fail=function(){
		this.code=null;
		this.description=null;
		this.referer=null;
		this.fatal=null;
	};
};
module.exports = CategoriasCadastroJsonClient;