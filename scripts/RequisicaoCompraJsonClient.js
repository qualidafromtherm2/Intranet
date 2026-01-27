var OMIE_APP_KEY = 'PUT_YOUR_APP_KEY_HERE';
var OMIE_APP_SECRET = 'PUT_YOUR_APP_SECRET_HERE';

var XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;
var RequisicaoCompraJsonClient=function(){
	this._EndPoint="https://app.omie.com.br/api/v1/produtos/requisicaocompra/";
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
	this.IncluirReq=function(
		requisicaoCadastro,
		_cb
	){
		return this._Call(
			"IncluirReq",
			[
			requisicaoCadastro
			],
			(_cb)?_cb:null
		);
	};
	this.AlterarReq=function(
		requisicaoCadastro,
		_cb
	){
		return this._Call(
			"AlterarReq",
			[
			requisicaoCadastro
			],
			(_cb)?_cb:null
		);
	};
	this.ExcluirReq=function(
		rcChave,
		_cb
	){
		return this._Call(
			"ExcluirReq",
			[
			rcChave
			],
			(_cb)?_cb:null
		);
	};
	this.UpsertReq=function(
		requisicaoCadastro,
		_cb
	){
		return this._Call(
			"UpsertReq",
			[
			requisicaoCadastro
			],
			(_cb)?_cb:null
		);
	};
	this.ConsultarReq=function(
		rcChave,
		_cb
	){
		return this._Call(
			"ConsultarReq",
			[
			rcChave
			],
			(_cb)?_cb:null
		);
	};
	this.PesquisarReq=function(
		rcListarRequest,
		_cb
	){
		return this._Call(
			"PesquisarReq",
			[
			rcListarRequest
			],
			(_cb)?_cb:null
		);
	};
	this.ItensReqCompra=function(){
		this.codItem=null;
		this.codIntItem=null;
		this.codProd=null;
		this.codIntProd=null;
		this.qtde=null;
		this.precoUnit=null;
		this.obsItem=null;
	};
	this.rcChave=function(){
		this.codReqCompra=null;
		this.codIntReqCompra=null;
	};
	this.rcListarRequest=function(){
		this.pagina=null;
		this.registros_por_pagina=null;
		this.apenas_importado_api=null;
		this.ordenar_por=null;
		this.ordem_descrescente=null;
		this.filtrar_por_data_de=null;
		this.filtrar_por_data_ate=null;
		this.filtrar_apenas_inclusao=null;
		this.filtrar_apenas_alteracao=null;
	};
	this.rcListarResponse=function(){
		this.pagina=null;
		this.total_de_paginas=null;
		this.registros=null;
		this.total_de_registros=null;
		this.requisicaoCadastro=null;
	};
	this.requisicaoCadastro=function(){
		this.codReqCompra=null;
		this.codIntReqCompra=null;
		this.codCateg=null;
		this.codProj=null;
		this.dtSugestao=null;
		this.obsReqCompra=null;
		this.obsIntReqCompra=null;
		this.ItensReqCompra=null;
	};
	this.rcStatus=function(){
		this.codReqCompra=null;
		this.codIntReqCompra=null;
		this.cCodStatus=null;
		this.cDesStatus=null;
	};
	this.omie_fail=function(){
		this.code=null;
		this.description=null;
		this.referer=null;
		this.fatal=null;
	};
};
module.exports = RequisicaoCompraJsonClient;