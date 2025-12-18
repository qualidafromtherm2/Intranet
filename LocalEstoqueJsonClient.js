var OMIE_APP_KEY = 'PUT_YOUR_APP_KEY_HERE';
var OMIE_APP_SECRET = 'PUT_YOUR_APP_SECRET_HERE';

var XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;
var LocalEstoqueJsonClient=function(){
	this._EndPoint="https://app.omie.com.br/api/v1/estoque/local/";
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
	this.ListarLocaisEstoque=function(
		locaisListarRequest,
		_cb
	){
		return this._Call(
			"ListarLocaisEstoque",
			[
			locaisListarRequest
			],
			(_cb)?_cb:null
		);
	};
	this.IncluirLocalEstoque=function(
		IncluirLocalRequest,
		_cb
	){
		return this._Call(
			"IncluirLocalEstoque",
			[
			IncluirLocalRequest
			],
			(_cb)?_cb:null
		);
	};
	this.AlterarLocalEstoque=function(
		alterarLocalRequest,
		_cb
	){
		return this._Call(
			"AlterarLocalEstoque",
			[
			alterarLocalRequest
			],
			(_cb)?_cb:null
		);
	};
	this.alterarLocalRequest=function(){
		this.codigo_local_estoque=null;
		this.codigo=null;
		this.descricao=null;
		this.tipo=null;
		this.consiSugeCompra=null;
		this.codigo_cliente=null;
		this.dispOrdemProducao=null;
		this.dispConsumoOP=null;
		this.dispRemessa=null;
		this.dispVenda=null;
	};
	this.alterarLocalResponse=function(){
		this.codigo_local_estoque=null;
		this.cCodStatus=null;
		this.cDesStatus=null;
	};
	this.IncluirLocalRequest=function(){
		this.codigo=null;
		this.descricao=null;
		this.tipo=null;
		this.consiSugeCompra=null;
		this.codigo_cliente=null;
		this.dispOrdemProducao=null;
		this.dispConsumoOP=null;
		this.dispRemessa=null;
		this.dispVenda=null;
	};
	this.incluirLocalResponse=function(){
		this.codigo_local_estoque=null;
		this.codigo=null;
		this.cCodStatus=null;
		this.cDesStatus=null;
	};
	this.locaisEncontrados=function(){
		this.codigo_local_estoque=null;
		this.codigo=null;
		this.descricao=null;
		this.tipo=null;
		this.padrao=null;
		this.inativo=null;
		this.codigo_cliente=null;
		this.dispOrdemProducao=null;
		this.dispConsumoOP=null;
		this.dispRemessa=null;
		this.dispVenda=null;
		this.dInc=null;
		this.hInc=null;
		this.uInc=null;
		this.dAlt=null;
		this.hAlt=null;
		this.uAlt=null;
	};
	this.locaisListarRequest=function(){
		this.nPagina=null;
		this.nRegPorPagina=null;
		this.filtrar_por_data_de=null;
		this.filtrar_por_hora_de=null;
		this.filtrar_por_data_ate=null;
		this.filtrar_por_hora_ate=null;
		this.filtrar_apenas_inclusao=null;
		this.filtrar_apenas_alteracao=null;
	};
	this.locaisListarResponse=function(){
		this.nPagina=null;
		this.nTotPaginas=null;
		this.nRegistros=null;
		this.nTotRegistros=null;
		this.locaisEncontrados=null;
	};
	this.omie_fail=function(){
		this.code=null;
		this.description=null;
		this.referer=null;
		this.fatal=null;
	};
};
module.exports = LocalEstoqueJsonClient;